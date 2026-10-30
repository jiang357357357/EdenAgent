import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { cp, readFile, writeFile, mkdir, mkdtemp, rm, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { packageDesktopControl } from './desktop_resources.mjs'
import { serverDependencyPlan } from './server_dependency_plan.mjs'
import { DesktopBrokerClient } from '../../Server/src/modules/desktop/broker-client.ts'
import { CuaTransport } from '../../Server/src/modules/desktop/cua-transport.ts'

test('packaged Cua worker, official native SDK and broker run without workspace source or external Cua install',
  { skip: process.platform !== 'win32', timeout: 45000 }, async t => {
    const root = fileURLToPath(new URL('../../', import.meta.url))
    const scratch = await mkdtemp(path.join(tmpdir(), 'eden-desktop-artifact-'))
    let child, client, transport
    t.after(async () => {
      client?.close()
      await transport?.close()
      if (child && child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill(); await exit }
      assert.equal(path.dirname(scratch), path.resolve(tmpdir()))
      assert.ok(path.basename(scratch).startsWith('eden-desktop-artifact-'))
      await rm(scratch, { recursive: true, force: true })
    })
    await mkdir(path.join(scratch, 'server'))
    const manifest = await packageDesktopControl(root, path.join(scratch, 'server'))
    for (const kind of ['broker', 'observer', 'cuaWorker', 'cuaLicense']) {
      assert.equal(createHash('sha256').update(await readFile(path.join(scratch, manifest[kind]))).digest('hex'), manifest[`${kind}Sha256`])
    }
    const plan = serverDependencyPlan(root)
    assert.equal(plan.find(p => p.name === '@trycua/cua-driver').version, '0.28.0')
    const dependencies = plan.filter(p => /^(?:@trycua|@ubjs|@koromix)\//.test(p.name)
      || ['koffi', 'zod', 'ajv', 'fast-deep-equal', 'fast-uri', 'json-schema-traverse', 'require-from-string'].includes(p.name))
    for (const dependency of dependencies) await cp(dependency.source, path.join(scratch, 'node_modules', dependency.relative), {
      recursive: true, filter: source => path.basename(source) !== 'node_modules',
    })
    await cp(process.execPath, path.join(scratch, 'node.exe'))
    await assert.rejects(access(path.join(scratch, 'Server/src')))
    await assert.rejects(access(path.join(scratch, 'server/desktop-computer-use.json')))
    transport = new CuaTransport(() => spawn(path.join(scratch, 'node.exe'), [path.join(scratch, manifest.cuaWorker)],
      { cwd: scratch, windowsHide: true, stdio: 'pipe', env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' } }))
    const signal = AbortSignal.timeout(20000)
    const catalog = await transport.request('catalog', {}, signal)
    assert.equal(catalog.length, 56)
    // Real native enumeration performs no capture, clipboard reads, activation, launch or input.
    const windows = await transport.request('windows', {}, signal)
    assert.ok(Array.isArray(windows))
    const raw = await transport.request('native', { name: 'list_apps', input: {} }, signal)
    assert.equal(raw.status, 'delivered'); assert.equal(raw.images.length, 0)
    await transport.request('prepare', {}, signal)
    const sessions = await transport.request('native', { name: 'list_sessions', input: {} }, signal)
    assert.equal(sessions.status, 'delivered')
    assert.doesNotMatch(sessions.structuredJson, /eden-[a-f0-9]{8}-[a-f0-9-]{27}/)
    const inspected = { windows: windows.length, tools: catalog.length, backend: 'eden.cua-driver.0.28.0', nativeSessionLifecycle: true }
    await transport.close(); transport = undefined
    const brokerRoot = path.join(scratch, 'broker-state')
    await mkdir(brokerRoot)
    await writeFile(path.join(brokerRoot, 'broker-token.json'), JSON.stringify({ token: 'a'.repeat(64), protocol: 'eden.desktop.1', pid: process.pid }))
    const initialControl = JSON.stringify({ paused: true, stopped: false })
    await writeFile(path.join(brokerRoot, 'control.json'), initialControl)
    let stderr = '', launches = 0
    client = new DesktopBrokerClient(brokerRoot, { launch: () => {
      launches++
      child = spawn(path.join(scratch, 'node.exe'), [path.join(scratch, manifest.broker), brokerRoot],
        { cwd: scratch, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' } })
      child.stderr.on('data', bytes => { stderr += bytes })
    } })
    const connected = await client.connect(true)
    assert.equal(connected, true, stderr)
    assert.equal(launches, 1)
    assert.equal(JSON.parse(await readFile(path.join(brokerRoot, 'broker-token.json'), 'utf8')).protocol, 'eden.desktop.3')
    const status = await client.request({ type: 'status' })
    assert.equal(status.busy, false); assert.equal(status.observerAvailable, false); assert.equal(status.paused, true)
    assert.equal(await readFile(path.join(brokerRoot, 'control.json'), 'utf8'), initialControl)
    const stopped = await client.request({ type: 'control', action: 'stop' })
    assert.equal(stopped.stopped, true)
    const controlFile = JSON.parse(await readFile(path.join(brokerRoot, 'control.json'), 'utf8'))
    assert.equal(controlFile.paused, false); assert.equal(controlFile.stopped, true)
    assert.equal(controlFile.control.source, 'manual'); assert.equal(controlFile.control.action, 'stop')
    const evidence = path.resolve(process.env.EDEN_DESKTOP_ARTIFACT_EVIDENCE || path.join(root, '.artifacts/cua-embedded-20261024/artifact'))
    await mkdir(evidence, { recursive: true })
    await writeFile(path.join(evidence, 'report.json'), JSON.stringify({ passed: true, node: process.versions.node,
      manifest, dependencies: dependencies.map(({ source, ...p }) => p), inspected, status, stopped,
      nativeInputPerformed: false, staleRegistrationRecovered: true, pausePreserved: true }, null, 2))
  })
