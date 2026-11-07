import { readFile, writeFile, cp, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const agent = fileURLToPath(new URL('../../', import.meta.url)), evidence = path.resolve(agent, '../.run/logs')
const fixtureFile = path.join(evidence, 'plugin-desktop-fixture.json')
const fixture = JSON.parse(await readFile(fixtureFile, 'utf8'))
const resources = path.join(fixture.app, 'resources')
const runtimeFile = path.join(resources, 'runtime-manifest.json')
const runtime = JSON.parse(await readFile(runtimeFile, 'utf8'))
const desktopFile = path.join(fixture.app, 'desktop-manifest.json')
const desktop = JSON.parse(await readFile(desktopFile, 'utf8'))
const fields = { 'main.mjs': 'entrySha256', 'runtime-process.mjs': 'runtimeProcessSha256',
  'workspace-search-worker.mjs': 'searchWorkerSha256', 'shared-workspace-host.mjs': 'sharedHostSha256',
  'shared-workspace-install.mjs': 'sharedHostInstallerSha256' }
const changed = []
async function refresh(relative, source) {
  const target = path.join(fixture.app, relative), bytes = await readFile(source)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (createHash('sha256').update(await readFile(target)).digest('hex') !== sha256) {
    await cp(source, target)
    const entry = desktop.entries.find(item => item.file === relative.split(path.sep).join('/'))
    if (!entry) throw new Error(`Artifact file is missing from inventory: ${relative}`)
    entry.bytes = bytes.length; entry.sha256 = sha256; changed.push(relative)
  }
  return sha256
}
for (const [name, field] of Object.entries(fields)) {
  runtime[field] = await refresh(`resources/server/${name}`, path.join(agent, 'dist/server', name))
  try { await stat(path.join(agent, 'dist/server', `${name}.map`)) }
  catch { continue }
  await refresh(`resources/server/${name}.map`, path.join(agent, 'dist/server', `${name}.map`))
}
await writeFile(runtimeFile, JSON.stringify(runtime, null, 2) + '\n')
const runtimeBytes = await readFile(runtimeFile)
Object.assign(desktop.entries.find(item => item.file === 'resources/runtime-manifest.json'), {
  bytes: runtimeBytes.length, sha256: createHash('sha256').update(runtimeBytes).digest('hex'),
})
desktop.runtimeEntrySha256 = runtime.entrySha256; desktop.runtimeProcessSha256 = runtime.runtimeProcessSha256
await writeFile(desktopFile, JSON.stringify(desktop, null, 2) + '\n')
fixture.initialServerSha256 ??= fixture.serverSha256
fixture.serverSha256 = runtime.entrySha256; fixture.guideFixApplied = true
await writeFile(fixtureFile, JSON.stringify(fixture, null, 2))
for (const name of ['Eden Agent 统一插件系统.md', '智能体前端扩展.md', 'Eden Agent 工具与技能按需加载.md'])
  await cp(path.join(agent, '文档/技术', name), path.join(fixture.workspace, 'docs', name))
console.log(JSON.stringify({ refreshedLocalTestArtifact: true, changed, serverSha256: runtime.entrySha256 }))
