import { readFile, writeFile, rm, realpath, readdir, stat, cp } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stageDesktopWeb, snapshotStartupScene } from '../../frontend/Script/Project/startup_scene.mjs'

const agent = fileURLToPath(new URL('../../', import.meta.url)), evidence = path.resolve(agent, '../.run/logs')
const fixture = JSON.parse(await readFile(path.join(evidence, 'plugin-desktop-fixture.json'), 'utf8'))
const root = await realpath(fixture.root), web = path.join(fixture.app, 'resources/app/web/dist')
const resolved = await realpath(web), relative = path.relative(root, resolved)
if (path.isAbsolute(relative) || relative.startsWith('..') || !path.basename(root).startsWith('eden-plugin-desktop-')) throw new Error('Refusing to replace web resources outside the local test artifact')
const source = path.join(agent, 'frontend/web/dist'), startup = await snapshotStartupScene(path.join(source, 'startup-scene'))
await rm(resolved, { recursive: true, force: true })
await stageDesktopWeb(source, web, startup)
const manifestFile = path.join(fixture.app, 'desktop-manifest.json')
const manifest = JSON.parse(await readFile(manifestFile, 'utf8')), prefix = 'resources/app/web/dist/'
manifest.entries = manifest.entries.filter(item => !item.file.startsWith(prefix))
async function inventory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) { await inventory(filename); continue }
    if (!entry.isFile()) throw new Error('Unexpected web resource type')
    const info = await stat(filename), bytes = await readFile(filename)
    manifest.entries.push({ file: path.relative(fixture.app, filename).split(path.sep).join('/'), kind: 'file',
      bytes: bytes.length, mode: info.mode & 0o777, sha256: createHash('sha256').update(bytes).digest('hex') })
  }
}
await inventory(web); manifest.entries.sort((a, b) => a.file.localeCompare(b.file))
for (const relative of ['desktop/src/app/local-runtime-service.cjs', 'desktop/src/main.cjs', 'desktop/src/processes/verify-workspace-endpoint.cjs']) {
  const file = `resources/app/${relative}`, source = path.join(agent, 'frontend', relative), bytes = await readFile(source)
  await cp(source, path.join(fixture.app, file))
  Object.assign(manifest.entries.find(item => item.file === file), { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
}
await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify({ refreshedLocalWeb: true, files: manifest.entries.filter(item => item.file.startsWith(prefix)).length }))
