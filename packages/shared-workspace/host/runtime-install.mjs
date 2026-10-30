import * as fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const files = { node: 'node', monpm: 'monpm', libstdcpp: 'libstdc++.so.6', libgcc: 'libgcc_s.so.1' }

async function regular(filename, directory = false) {
  try {
    const value = await fs.lstat(filename)
    if (value.isSymbolicLink() || !(directory ? value.isDirectory() : value.isFile())) throw new Error('runtime_corrupt')
    return value
  } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
async function verified(filename, expected) {
  const info = await regular(filename)
  if (!info || info.size !== expected.size) throw new Error('runtime_corrupt')
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(filename)) hash.update(bytes)
  if (hash.digest('hex') !== expected.sha256) throw new Error('runtime_corrupt')
}
async function notices(directory, texts) {
  for (const [name, text] of [['LICENSE.node.txt', texts?.node], ['NOTICE.monpm.txt', texts?.monpm], ['NOTICE.cpp.txt', texts?.cpp]]) {
    if (typeof text !== 'string' || !text.trim() || text.length > 512 * 1024) throw new Error('runtime_corrupt')
    const filename = path.join(directory, name), existing = await regular(filename)
    if (existing) {
      if (await fs.readFile(filename, 'utf8') !== text) throw new Error('runtime_corrupt')
    } else await fs.writeFile(filename, text, { mode: 0o600, flag: 'wx' })
  }
}

/** Immutable content-addressed runtime directories keep a running daemon's executable intact. */
export async function installHostRuntime(root, runtime) {
  if (!runtime || !/^[a-f0-9]{24}$/.test(runtime.id)) throw new Error('runtime_corrupt')
  const parent = path.join(root, 'runtime'), target = path.join(parent, runtime.id)
  await regular(parent, true); await fs.mkdir(parent, { recursive: true, mode: 0o700 })
  if (await regular(target, true)) {
    for (const [name, file] of Object.entries(files)) await verified(path.join(target, file), runtime[name])
    await notices(target, runtime.notices)
  } else {
    const stage = await fs.mkdtemp(path.join(parent, '.prepare-'))
    try {
      for (const [name, file] of Object.entries(files)) {
        await verified(runtime[name].path, runtime[name])
        const filename = path.join(stage, file)
        await fs.copyFile(runtime[name].path, filename)
        await fs.chmod(filename, 0o700)
        await verified(filename, runtime[name])
      }
      await fs.writeFile(path.join(stage, 'runtime.json'), JSON.stringify({ schemaVersion: 2, id: runtime.id,
        hashes: Object.fromEntries(Object.keys(files).map(name => [name, runtime[name].sha256])) }), { flag: 'wx', mode: 0o600 })
      await notices(stage, runtime.notices)
      await fs.rename(stage, target)
    } catch (error) {
      for (const name of [...Object.values(files), 'runtime.json', 'LICENSE.node.txt', 'NOTICE.monpm.txt', 'NOTICE.cpp.txt']) await fs.unlink(path.join(stage, name)).catch(failure => { if (failure.code !== 'ENOENT') throw failure })
      await fs.rmdir(stage); throw error
    }
  }
  return { node: path.join(target, 'node'), monpm: path.join(target, 'monpm'), libraryPath: target }
}
