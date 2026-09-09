import { cp, lstat, readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const official = ['hoi4', 'lichess', 'openttd', 'victoria3']
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export async function copyConnectorResources(root, staging) {
  const platform = `${process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform}-${process.arch}`
  const packages = []
  for (const key of official) {
    const source = path.join(root, 'dist/connectors', key)
    const files = await packageFiles(source)
    const checksumBytes = await readFile(path.join(source, 'checksums.json'))
    const checksums = JSON.parse(checksumBytes.toString('utf8'))
    if (!checksums || typeof checksums !== 'object' || Array.isArray(checksums)) throw new Error(`Invalid checksums for ${key}`)
    const actual = files.filter(name => name !== 'checksums.json').sort()
    if (JSON.stringify(actual) !== JSON.stringify(Object.keys(checksums).sort())) throw new Error(`Incomplete connector inventory: ${key}`)
    for (const name of actual) {
      if (!/^[a-f0-9]{64}$/.test(checksums[name]) || sha256(await readFile(path.join(source, name))) !== checksums[name]) {
        throw new Error(`Connector checksum mismatch: ${key}/${name}`)
      }
    }
    const manifest = JSON.parse(await readFile(path.join(source, 'connector.json'), 'utf8'))
    const entry = manifest.entrypoints?.[platform]?.path
    if (manifest.id !== key || !actual.includes(entry)) throw new Error(`Missing ${platform} worker: ${key}`)
    const destination = path.join(staging, 'connectors', key)
    await cp(source, destination, { recursive: true, dereference: false, filter: async name => {
      if ((await lstat(name)).isSymbolicLink()) throw new Error('Connector resources cannot contain symbolic links')
      return true
    } })
    // Validate copied bytes as well, so packaging cannot bless a changed source file.
    if (JSON.stringify((await packageFiles(destination)).sort()) !== JSON.stringify(files.sort())
      || !checksumBytes.equals(await readFile(path.join(destination, 'checksums.json')))) {
      throw new Error(`Connector inventory changed while packaging: ${key}`)
    }
    for (const name of actual) {
      if (sha256(await readFile(path.join(destination, name))) !== checksums[name]) throw new Error(`Connector changed while packaging: ${key}`)
    }
    packages.push({ id: key, version: manifest.version, platform, entry, files: checksums })
  }
  return packages
}

async function packageFiles(root, prefix = '') {
  if (!(await lstat(root)).isDirectory()) throw new Error('Connector package must be a directory')
  const files = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...await packageFiles(path.join(root, entry.name), relative))
    else if (entry.isFile()) files.push(relative)
    else throw new Error(`Unsupported connector resource: ${relative}`)
  }
  return files
}
