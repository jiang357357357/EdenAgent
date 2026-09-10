import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rename, rm, lstat, writeFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const agentRoot = fileURLToPath(new URL('../../', import.meta.url))

/** Build any connector source directory. Official packages use exactly this entrypoint. */
export async function packageConnector(source, destination) {
  const root = await realpath(source), metadata = path.join(root, 'package')
  const manifest = JSON.parse(await readFile(path.join(metadata, 'connector.json'), 'utf8'))
  const plugin = JSON.parse(await readFile(path.join(metadata, 'plugin.json'), 'utf8'))
  if (manifest.runtime !== 'node' || manifest.entrypoints?.node?.path !== 'worker/main.mjs') throw new Error('Connector requires the portable Node worker entrypoint')
  if (!plugin.components?.runtimes?.some(component => component.kind === 'connector' && component.manifest === 'connector.json')) throw new Error('Plugin must declare a connector component')
  const staging = destination + `.staging-${randomUUID()}`, backup = destination + `.backup-${randomUUID()}`
  await mkdir(path.dirname(destination), { recursive: true })
  let replaced = false
  try {
    await cp(metadata, staging, { recursive: true, filter: async file => {
      if ((await lstat(file)).isSymbolicLink()) throw new Error('Connector package cannot contain symlinks')
      return !['checksums.json', 'signature.json', 'workers', 'worker'].includes(path.relative(metadata, file).split(path.sep)[0])
    } })
    await build({ entryPoints: [path.join(root, 'src/main.ts')], outfile: path.join(staging, 'worker/main.mjs'), bundle: true,
      platform: 'node', target: 'node22', format: 'esm', sourcemap: false, packages: 'bundle' })
    const checksums = {}
    for (const file of await files(staging)) checksums[path.relative(staging, file).split(path.sep).join('/')] = createHash('sha256').update(await readFile(file)).digest('hex')
    await writeFile(path.join(staging, 'checksums.json'), JSON.stringify(checksums, null, 2) + '\n')
    try { await rename(destination, backup); replaced = true } catch (error) { if (error.code !== 'ENOENT') throw error }
    await rename(staging, destination)
    if (replaced) await rm(backup, { recursive: true, force: true })
    return { connectorId: manifest.id, runtime: 'node', destination }
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    if (replaced) { try { await lstat(destination) } catch { await rename(backup, destination) } }
    throw error
  }
}
async function files(root) {
  const result = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) result.push(...await files(file))
    else if (entry.isFile()) result.push(file)
    else throw new Error('Connector package contains a special file')
  }
  return result.sort()
}
export async function packageOfficialConnectors() {
  const source = path.join(agentRoot, 'Server/connectors/official')
  for (const entry of await readdir(source, { withFileTypes: true })) if (entry.isDirectory() && /^[a-z][a-z0-9.-]*$/.test(entry.name)) {
    await packageConnector(path.join(source, entry.name), path.join(agentRoot, 'dist/connectors', entry.name))
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const key = process.argv[2]
  if (key === '--all') await packageOfficialConnectors()
  else if (key === '--source' && process.argv[3] && process.argv[4]) console.log(await packageConnector(path.resolve(process.argv[3]), path.resolve(process.argv[4])))
  else if (key && /^[a-z][a-z0-9.-]*$/.test(key)) console.log(await packageConnector(path.join(agentRoot, 'Server/connectors/official', key), path.join(agentRoot, 'dist/connectors', key)))
  else throw new Error('Usage: package_connector.mjs --all | <id> | --source <directory> <destination>')
}
