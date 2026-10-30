import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--source') throw new Error('Usage: node Script/Project/prepare_startup_scene.mjs --source PATH_TO_ShittimLogon-Omega')
const source = path.resolve(args[1])
const target = fileURLToPath(new URL('../../frontend/web/public/startup-scene/', import.meta.url))
const models = ['arona_workpage_daytime_2', 'arona_workpage_nighttime_2', 'arona_spr', 'NP0035_spr']
const files = models.flatMap(name => [name + '.skel', name + '.atlas', name + '.png'])
files.push('arona_workpage_daytime_2_2.png', 'arona_workpage_nighttime_2_2.png', 'thumb-day_3.png', 'thumb-night_3.png')
const entries = files.map(name => ({ from: path.join('assets', name), to: name }))
entries.push(...['LICENSE.txt', 'NOTICE.txt', 'SPINE-LICENSE.txt'].map(name => ({ from: name, to: name })))
// Validate all required source files before changing the local asset directory.
const contents = await Promise.all(entries.map(async item => ({ ...item, bytes: await readFile(path.join(source, item.from)) })))
await mkdir(target, { recursive: true })
for (const item of contents) await copyFile(path.join(source, item.from), path.join(target, item.to))
const manifest = { source: 'Local ShittimLogon-Omega package', preparedAt: new Date().toISOString(), localOnly: true,
  files: contents.map(item => ({ name: item.to, bytes: item.bytes.length, sha256: createHash('sha256').update(item.bytes).digest('hex') })) }
await writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`Prepared ${entries.length} local startup scene files in ${target}`)
