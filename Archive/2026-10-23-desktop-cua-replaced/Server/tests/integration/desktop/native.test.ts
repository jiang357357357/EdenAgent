import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { EdenDatabase } from '@eden/store'
import { SessionRepository } from '../../../src/modules/sessions/index.ts'
import { PermissionService } from '../../../src/modules/permissions/index.ts'
import { BlobRepository, BlobService } from '../../../src/modules/blobs/index.ts'
import { DesktopService, desktopTools } from '../../../src/modules/desktop/index.ts'
import { serveDesktopBroker } from '../../../src/modules/desktop/broker-server.ts'
import { startInputObserver } from '../../../src/modules/desktop/input-observer.ts'
import { createNativeDriver } from '../../../src/modules/desktop/native-driver.ts'
import type { DesktopDriver } from '../../../src/modules/desktop/contracts.ts'

const enabled = process.platform === 'win32' && process.env.EDEN_DESKTOP_NATIVE_TEST === '1'
const wait = async (condition: () => boolean) => {
  for (let n = 0; n < 100; n++) {
    try { if (condition()) return } catch (error) { if (!(error instanceof SyntaxError) && !['ENOENT', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error }
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('Native fixture did not reach expected app-owned state')
}

test('real Windows tools control two pre-existing windows and verify app-owned effects', { skip: !enabled, timeout: 120000 }, async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'eden-native-desktop-'))
  const artifacts = path.resolve('.artifacts/desktop-control-20261022/native')
  mkdirSync(artifacts, { recursive: true })
  const executable = path.join(directory, 'desktop-fixture.exe')
  const compiler = path.join(process.env.SystemRoot ?? 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
  await promisify(execFile)(compiler, ['/nologo', '/target:winexe', '/r:System.Windows.Forms.dll', '/r:System.Web.Extensions.dll',
    `/out:${executable}`, path.resolve('Server/tests/integration/desktop/native-fixture.cs')], { windowsHide: true })
  const prefix = `Eden Desktop Test ${randomUUID().slice(0, 8)}`
  writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify({ passed: false, startedAt: new Date().toISOString(), prefix }))
  // Start the app before the desktop broker, proving that agent ownership is not required.
  const child = spawn(executable, [directory, prefix], { windowsHide: false, stdio: 'ignore' })
  const databases: EdenDatabase[] = [], services: DesktopService[] = []
  const report: Record<string, unknown>[] = []
  let bodyCompleted = false
  let broker: Awaited<ReturnType<typeof serveDesktopBroker>> | undefined
  let cleanupDriver: DesktopDriver | undefined
  const extraDirectory = path.join(directory, 'extra')
  t.after(async () => {
    if (broker) writeFileSync(path.join(artifacts, 'final-control-state.json'), JSON.stringify(broker.arbiter.status('', true), null, 2))
    if (existsSync(path.join(directory, 'state.json'))) writeFileSync(path.join(artifacts, 'final-app-state.json'), readFileSync(path.join(directory, 'state.json')))
    const cleanupErrors: unknown[] = []
    const clean = async (work: () => unknown) => { try { await work() } catch (error) { cleanupErrors.push(error) } }
    for (const service of services) service.close()
    await clean(async () => {
      if (cleanupDriver && existsSync(path.join(extraDirectory, 'state.json'))) {
        const pid = JSON.parse(readFileSync(path.join(extraDirectory, 'state.json'), 'utf8')).processId
        await cleanupDriver.act('kill_app', { pid }, AbortSignal.timeout(5000))
      }
    })
    await clean(() => broker?.close())
    await clean(async () => {
      child.kill(); await new Promise<void>(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', () => resolve()) })
    })
    for (const database of databases) await clean(() => database.close())
    await clean(() => {
      assert.equal(path.dirname(directory), path.resolve(tmpdir()))
      assert.ok(path.basename(directory).startsWith('eden-native-desktop-'))
      rmSync(directory, { recursive: true, force: true })
    })
    writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify({ passed: bodyCompleted && !cleanupErrors.length,
      prefix, finishedAt: new Date().toISOString(), report, bodyCompleted, cleanupErrors: cleanupErrors.map(String),
      twoWorlds: bodyCompleted, foreignWindowReferencesRejected: bodyCompleted, sharedStop: bodyCompleted }, null, 2))
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Native fixture cleanup failed')
  })
  await wait(() => existsSync(path.join(directory, 'ready')))
  const root = path.join(directory, 'broker')
  broker = await serveDesktopBroker(root, { driver: async () => {
    const native = await createNativeDriver()
    cleanupDriver = native
    return { ...native, async act(name, args, signal) {
      try { return await native.act(name, args, signal) }
      catch (error) {
        const cause = error instanceof Error ? error.cause as any : undefined
        writeFileSync(path.join(artifacts, 'driver-error.json'), JSON.stringify({ name, args, error: String(error), cause: String(cause), tag: cause?.tag, detail: cause?.inner }, null, 2))
        throw error
      }
    } }
  }, observer: async callback => {
    const observer = await startInputObserver(callback)
    return { get available() { return observer.available }, close: () => observer.close(),
      window: (...args) => observer.window(...args),
      hit: (...args) => observer.hit!(...args),
      async identify(window) {
        try { return await observer.identify(window) }
        catch (error) { if (window.pid === child.pid) writeFileSync(path.join(artifacts, 'identity-diagnostic.json'), JSON.stringify({ window, error: String(error) }, null, 2)); throw error }
      },
      async windows() { const all = await observer.windows!(); writeFileSync(path.join(artifacts, 'observer-discovery.json'), JSON.stringify(all.filter(w => w.pid === child.pid), null, 2)); return all },
    }
  } })
  function account(origin: 'mon' | 'local') {
    const database = new EdenDatabase(':memory:', origin); databases.push(database)
    const repository = new SessionRepository(database, origin)
    const session = repository.create('Native desktop fixture', [{ assistantId: 1 }], null)
    const permissions = new PermissionService(database, repository.events); permissions.setMode('full_access')
    const blobs = new BlobService(path.join(directory, origin, 'blobs'), new BlobRepository(database))
    const service = new DesktopService(database, repository, blobs, root); services.push(service)
    const tools = desktopTools(service, permissions, session.id, randomUUID())
    const call = async (name: string, input: Record<string, unknown>) => {
      const result = await tools.find(t => t.name === name)!.execute(input, { callId: randomUUID(), signal: AbortSignal.timeout(40000) }).catch(error => {
        writeFileSync(path.join(artifacts, 'last-failure.json'), JSON.stringify({ name, input, error: String(error) }, null, 2)); throw error
      })
      writeFileSync(path.join(artifacts, 'last-result.json'), JSON.stringify({ name, input, result }, null, 2))
      return result as any
    }
    return { call, service, blobs }
  }
  const mon = account('mon'), local = account('local')
  const discovered = await mon.call('desktop_list_windows', { query: prefix })
  writeFileSync(path.join(artifacts, 'fixture-ready-state.json'), readFileSync(path.join(directory, 'state.json')))
  if (discovered.windows.length !== 2) {
    const sdk = await import('@trycua/cua-driver'), diagnostic = sdk.CuaDriver.create(undefined)
    try {
      const windows = await diagnostic.listWindows(sdk.ListWindowsInput.new({ pid: child.pid! }))
      writeFileSync(path.join(artifacts, 'discovery-diagnostic.json'), JSON.stringify(windows, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2))
    } finally { await diagnostic.shutdown(); if ('uniffiDestroy' in diagnostic && typeof diagnostic.uniffiDestroy === 'function') diagnostic.uniffiDestroy() }
  }
  assert.equal(discovered.windows.length, 2)
  for (const key of ['A', 'B']) {
    const window = discovered.windows.find((w: any) => w.title === `${prefix} ${key}`)
    const before = await mon.call('desktop_observe', { window: window.window })
    writeFileSync(path.join(artifacts, `observation-${key}.json`), JSON.stringify(before, null, 2))
    const input = before.elements.find((e: any) => e.label === 'EdenInput')
    assert.ok(input, 'fixture textbox must be exposed by UIA')
    assert.ok(before.images?.length, 'native window screenshot must enter Blob storage')
    const image = await mon.blobs.read(before.images[0].blobId)
    writeFileSync(path.join(artifacts, `before-${key}.png`), image.bytes)
    const text = `Eden ${key} 跨窗口输入 2026-10-22`
    const typed = await mon.call('desktop_type', { window: window.window, element: input.element, text, mode: 'replace' })
    assert.notEqual(typed.status, 'refused', JSON.stringify(typed))
    await wait(() => JSON.parse(readFileSync(path.join(directory, 'state.json'), 'utf8'))[key].text === text)
    const after = await mon.call('desktop_observe', { window: window.window })
    const button = after.elements.find((e: any) => e.label === 'EdenApply')
    assert.ok(button)
    const clicked = await mon.call('desktop_click', { window: window.window, element: button.element })
    assert.notEqual(clicked.status, 'refused', JSON.stringify(clicked))
    await wait(() => JSON.parse(readFileSync(path.join(directory, 'state.json'), 'utf8'))[key].applied === text)
    const confirmed = await mon.call('desktop_observe', { window: window.window })
    const shot = await mon.blobs.read(confirmed.images[0].blobId)
    writeFileSync(path.join(artifacts, `after-${key}.png`), shot.bytes)
    report.push({ window: key, text, typed, clicked, appOwnedState: JSON.parse(readFileSync(path.join(directory, 'state.json'), 'utf8'))[key] })
  }
  const readState = () => JSON.parse(readFileSync(path.join(directory, 'state.json'), 'utf8'))
  const first = discovered.windows.find((w: any) => w.title === `${prefix} A`)
  async function observedAction(name: string, extra: Record<string, unknown>) {
    const state = await mon.call('desktop_observe', { window: first.window })
    const element = state.elements.find((e: any) => e.label === 'EdenInput')
    let result = await mon.call(name, { window: first.window, element: element.element, ...extra })
    if (result.status === 'refused') {
      const fresh = await mon.call('desktop_observe', { window: first.window })
      result = await mon.call(name, { window: first.window, element: fresh.elements.find((e: any) => e.label === 'EdenInput').element, ...extra, delivery: 'foreground' })
    }
    assert.notEqual(result.status, 'refused', JSON.stringify(result))
    return result
  }
  await mon.call('desktop_window', { window: first.window, action: 'activate' })
  await mon.call('desktop_observe', { window: first.window })
  await mon.call('desktop_click', { window: first.window, x: 50, y: 65, delivery: 'foreground' })
  await observedAction('desktop_key', { keys: ['ctrl', 'end'], delivery: 'foreground' })
  await wait(() => readState().A.selection === readState().A.text.length)
  report.push({ key: 'ctrl-end', verifiedSelection: readState().A.selection })
  await observedAction('desktop_type', { text: Array.from({ length: 80 }, (_, i) => `Line ${i}`).join('\r\n'), mode: 'replace' })
  await observedAction('desktop_scroll', { direction: 'down', amount: 10 })
  await wait(() => readState().A.scroll > 0)
  report.push({ scroll: readState().A.scroll })
  const beforeDrag = await mon.call('desktop_observe', { window: first.window })
  let dragged = await mon.call('desktop_drag', { window: first.window, fromX: 50, fromY: 65, toX: 180, toY: 65, durationMs: 600 })
  if (dragged.status === 'refused' || (dragged.status === 'unknown' && !readState().A.drag && readState().A.selectionLength === 0)) {
    await mon.call('desktop_observe', { window: first.window })
    dragged = await mon.call('desktop_drag', { window: first.window, fromX: 50, fromY: 65, toX: 180, toY: 65, durationMs: 600, delivery: 'foreground' })
  }
  assert.notEqual(dragged.status, 'refused', JSON.stringify(dragged))
  await wait(() => readState().A.drag === true || readState().A.selectionLength > 0)
  report.push({ drag: dragged, screenshotDimensions: beforeDrag.screenshot, selectionLength: readState().A.selectionLength })
  await mon.call('desktop_window', { window: first.window, action: 'minimize' })
  await wait(() => readState().A.windowState === 'Minimized')
  await mon.call('desktop_window', { window: first.window, action: 'restore' })
  await wait(() => readState().A.windowState === 'Normal')
  report.push({ minimizeAndRestore: true })
  const second = discovered.windows.find((w: any) => w.title === `${prefix} B`)
  await mon.call('desktop_window', { window: second.window, action: 'activate' })
  await mon.call('desktop_window', { window: first.window, action: 'activate' })
  await mon.call('desktop_observe', { window: first.window })
  await mon.call('desktop_observe', { window: second.window })
  const transferred = await mon.call('desktop_drag', { window: first.window, toWindow: second.window,
    fromX: 50, fromY: 360, toX: 50, toY: 360, delivery: 'foreground', durationMs: 1000 })
  assert.notEqual(transferred.status, 'refused', JSON.stringify(transferred))
  await wait(() => readState().B.dropped === 'Eden cross-window proof')
  report.push({ crossWindowDrag: transferred, received: readState().B.dropped })
  const extraPrefix = `Eden Transfer Target ${randomUUID().slice(0, 8)}`
  const launched = await mon.call('desktop_launch', { application: executable, arguments: [extraDirectory, extraPrefix, 'single'] })
  assert.notEqual(launched.status, 'refused', JSON.stringify(launched))
  await wait(() => existsSync(path.join(extraDirectory, 'ready')))
  const extra = (await mon.call('desktop_list_windows', { query: extraPrefix })).windows
  assert.equal(extra.length, 1)
  await mon.call('desktop_window', { window: extra[0].window, action: 'activate' })
  await mon.call('desktop_window', { window: first.window, action: 'activate' })
  await mon.call('desktop_observe', { window: first.window })
  await mon.call('desktop_observe', { window: extra[0].window })
  const acrossProcesses = await mon.call('desktop_drag', { window: first.window, toWindow: extra[0].window,
    fromX: 50, fromY: 360, toX: 50, toY: 360, delivery: 'foreground', durationMs: 1000 })
  assert.notEqual(acrossProcesses.status, 'refused', JSON.stringify(acrossProcesses))
  await wait(() => JSON.parse(readFileSync(path.join(extraDirectory, 'state.json'), 'utf8')).B.dropped === 'Eden cross-window proof')
  const targetProcessDifferent = JSON.parse(readFileSync(path.join(extraDirectory, 'state.json'), 'utf8')).processId !== child.pid
  assert.equal(targetProcessDifferent, true)
  report.push({ launchedNewApp: launched.status, crossProcessDrag: acrossProcesses, targetProcessDifferent })
  const other = await local.call('desktop_list_windows', { query: prefix })
  assert.equal(other.windows.length, 2)
  await assert.rejects(local.call('desktop_observe', { window: discovered.windows[0].window }), /当前会话/)
  await mon.service.control('stop')
  assert.equal((await local.service.status()).stopped, true)
  await assert.rejects(local.call('desktop_observe', { window: other.windows[0].window }), /暂停或停止/)
  await local.service.control('resume')
  bodyCompleted = true
})
