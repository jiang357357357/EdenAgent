import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const args = process.argv.slice(2)
const options = new Map()
for (let index = 0; index < args.length; index += 2) {
  const name = args[index], value = args[index + 1]
  if (!['--source', '--output', '--version', '--distribution-notice'].includes(name) || !value || options.has(name))
    throw new Error('Usage: prepare_startup_scene.mjs --source PATH [--output PATH] [--version RESOURCE_VERSION --distribution-notice FILE]')
  options.set(name, value)
}
if (!options.has('--source')) throw new Error('--source is required')
if (options.has('--distribution-notice') !== options.has('--version')) throw new Error('Deliverable preparation requires both --version and --distribution-notice')
const version = options.get('--version') ?? 'local'
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(version) || version.includes('..')) throw new Error('Invalid independent resource version')
const source = path.resolve(options.get('--source'))
const target = path.resolve(options.get('--output') ?? fileURLToPath(new URL('../../frontend/web/public/startup-scene/', import.meta.url)))
const models = ['arona_workpage_daytime_2', 'arona_workpage_nighttime_2', 'arona_spr', 'NP0035_spr']
const files = models.flatMap(name => [name + '.skel', name + '.atlas', name + '.png'])
files.push('arona_workpage_daytime_2_2.png', 'arona_workpage_nighttime_2_2.png', 'thumb-day_3.png', 'thumb-night_3.png')
const entries = files.map(name => ({ from: path.join('assets', name), to: name }))
entries.push(...['LICENSE.txt', 'NOTICE.txt', 'SPINE-LICENSE.txt'].map(name => ({ from: name, to: name })))
// Validate all required source files before changing the local asset directory.
const contents = await Promise.all(entries.map(async item => ({ ...item, bytes: await readFile(path.join(source, item.from)) })))
if (options.has('--distribution-notice')) {
  const bytes = await readFile(path.resolve(options.get('--distribution-notice')))
  if (!bytes.toString('utf8').trim()) throw new Error('Distribution notice is empty')
  contents.push({ to: 'DISTRIBUTION-NOTICE.txt', bytes })
}
await mkdir(target, { recursive: true })
for (const item of contents) await writeFile(path.join(target, item.to), item.bytes)
const manifest = { schemaVersion: 1, resourceId: 'agent-startup-scene', version,
  source: 'User-provided ShittimLogon-Omega scene exports', preparedAt: new Date().toISOString(), localOnly: !options.has('--distribution-notice'),
  files: contents.map(item => ({ name: item.to, bytes: item.bytes.length, sha256: createHash('sha256').update(item.bytes).digest('hex') })) }
await writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`Prepared ${contents.length} ${manifest.localOnly ? 'local-only' : 'deliverable'} startup scene files in ${target}`)
