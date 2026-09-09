import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serverDependencyPlan } from './server_dependency_plan.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = path.resolve(process.argv[2] ?? path.join(root, 'dist', `runtime-${process.platform}-${process.arch}`))
if (process.argv.length > 3) throw new Error('Usage: node Script/Project/package_server.mjs [new-output-directory]')
if (existsSync(output)) throw new Error(`Refusing to replace existing runtime directory: ${output}`)
if (process.versions.node !== '22.23.1') throw new Error('Package with the pinned Node 22.23.1 runtime')
const entry = path.join(root, 'dist/server/main.mjs')
await stat(entry)
const packages = serverDependencyPlan(root)
const nodeDirectory = path.dirname(process.execPath)
const license = [path.join(nodeDirectory, 'LICENSE'), path.join(nodeDirectory, '../LICENSE')].find(existsSync)
if (!license) throw new Error('The Node distribution LICENSE must be present alongside the runtime')
const staging = `${output}.staging-${randomUUID()}`
await mkdir(staging, { recursive: true })
try {
  await mkdir(path.join(staging, 'server'))
  await cp(entry, path.join(staging, 'server/main.mjs'))
  await cp(`${entry}.map`, path.join(staging, 'server/main.mjs.map'))
  await mkdir(path.join(staging, 'node'))
  await cp(process.execPath, path.join(staging, 'node', process.platform === 'win32' ? 'node.exe' : 'node'))
  await cp(license, path.join(staging, 'node/LICENSE'))
  for (const dependency of packages) {
    await cp(dependency.source, path.join(staging, 'node_modules', dependency.relative), {
      recursive: true, filter: source => path.basename(source) !== 'node_modules',
    })
  }
  const lock = await readFile(path.join(root, 'package-lock.json'))
  const sha256 = value => createHash('sha256').update(value).digest('hex')
  await writeFile(path.join(staging, 'runtime-manifest.json'), JSON.stringify({
    format: 1, platform: process.platform, arch: process.arch, node: process.versions.node,
    entry: 'server/main.mjs', lockSha256: sha256(lock), entrySha256: sha256(await readFile(entry)),
    packages: packages.map(({ source, ...dependency }) => dependency),
  }, null, 2) + '\n')
  await rename(staging, output)
  process.stdout.write(`Packaged ${packages.length} runtime dependencies: ${output}\n`)
} catch (error) {
  await rm(staging, { recursive: true, force: true })
  throw error
}
