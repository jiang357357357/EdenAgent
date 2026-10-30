import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm, writeFile, readFile, readlink, symlink, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { build } from 'esbuild'
import { packageVideoRuntime } from './video_resources.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const runtime = process.env.EDEN_AGENT_VIDEO_RUNTIME_ROOT ?? path.join(root, 'Data/runtime/video-context')

test('packaged Python links remain relative when the original runtime moves away', { skip: process.platform === 'win32' }, async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'eden-video-links-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const source = path.join(temporary, 'source'), runtime = path.join(temporary, 'runtime')
  await mkdir(path.join(source, 'Server/resources/video-context'), { recursive: true })
  await mkdir(path.join(runtime, 'python/bin'), { recursive: true })
  await writeFile(path.join(runtime, 'python/bin/python3.12'), 'portable interpreter fixture')
  await symlink('python3.12', path.join(runtime, 'python/bin/python'))
  const output = path.join(temporary, 'portable/server')
  await packageVideoRuntime(source, output, runtime)
  const link = path.join(output, 'video-runtime/python/bin/python')
  assert.equal(await readlink(link), 'python3.12')
  await rename(runtime, runtime + '-moved')
  assert.equal(await readFile(link, 'utf8'), 'portable interpreter fixture')
})
test('bundled VideoContext runs with relocated Python, media tools and models', { skip: !existsSync(path.join(runtime, 'runtime.json')), timeout: 180000 }, async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'eden-video-artifact-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const output = path.join(temporary, 'portable/server')
  await mkdir(output, { recursive: true })
  await packageVideoRuntime(root, output, runtime)
  const probe = path.join(temporary, 'probe.ts')
  await writeFile(probe, `import { VideoContextBackend, defaultVideoRuntimeRoot } from ${JSON.stringify(path.join(root, 'Server/src/modules/video/backend.ts').replaceAll('\\', '/'))};
const backend = new VideoContextBackend(defaultVideoRuntimeRoot());
try { const result = await backend.call(process.argv[2], 'video_mcp_doctor', {}, AbortSignal.timeout(90000));
console.log(JSON.stringify(result)); } finally { await backend.close(); }`)
  await build({ absWorkingDir: root, entryPoints: [probe], outfile: path.join(output, 'probe.mjs'), bundle: true,
    platform: 'node', target: 'node22', format: 'esm', define: { EDEN_BUNDLED_SERVER: 'true' } })
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(output, 'probe.mjs'), path.join(temporary, 'scope')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk }); child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)))
  })
  assert.notEqual(result.isError, true)
  assert.equal(result.structuredContent.healthy, true)
  assert.equal(result.structuredContent.default_model, 'tiny')
  assert.ok(result.structuredContent.model_cache.startsWith(output))
  assert.ok(result.structuredContent.python.available)
  assert.ok(result.structuredContent.ffmpeg.available)
  assert.ok(result.structuredContent.whisper_backend.available)
  assert.equal(JSON.parse(await readFile(path.join(output, 'video-runtime/runtime.json'), 'utf8')).version, 1)
})
