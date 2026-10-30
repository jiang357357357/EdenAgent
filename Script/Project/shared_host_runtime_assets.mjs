import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { createGzip, createGunzip } from 'node:zlib'
import { Transform } from 'node:stream'

export async function digestFile(filename) {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(filename)) hash.update(bytes)
  return hash.digest('hex')
}
export async function downloadRuntime(url, filename, expectedHash) {
  try { if (await digestFile(filename) === expectedHash) return } catch (error) { if (error.code !== 'ENOENT') throw error }
  const stage = filename + '.download-' + randomUUID()
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(180_000) })
    if (!response.ok || !response.body) throw new Error(`Node runtime download failed: HTTP ${response.status}`)
    await pipeline(response.body, createWriteStream(stage, { flags: 'wx' }))
    if (await digestFile(stage) !== expectedHash) throw new Error('Official Node archive SHA-256 mismatch')
    await rename(stage, filename)
  } finally { await unlink(stage).catch(error => { if (error.code !== 'ENOENT') throw error }) }
}
export async function compressRuntime(source, output, file) {
  const stage = output + '.compress-' + randomUUID()
  try {
    await pipeline(createReadStream(source), createGzip({ level: 9 }), createWriteStream(stage, { flags: 'wx' }))
    await rename(stage, output)
  } finally { await unlink(stage).catch(error => { if (error.code !== 'ENOENT') throw error }) }
  return { file, size: (await stat(output)).size, sha256: await digestFile(output),
    rawSize: (await stat(source)).size, rawSha256: await digestFile(source) }
}
export async function verifyRuntimeAssets(root, manifest) {
  const path = await import('node:path')
  for (const architecture of ['x64', 'arm64']) for (const name of ['node', 'monpm', 'libstdcpp', 'libgcc']) {
    const asset = manifest.targets?.[`linux-${architecture}`]?.[name]
    if (!asset || asset.file !== `${name}-linux-${architecture}.gz`) throw new Error('Incomplete cloud runtime bundle')
    const filename = path.join(root, asset.file)
    if ((await stat(filename)).size !== asset.size || await digestFile(filename) !== asset.sha256) throw new Error('Cloud runtime bundle digest mismatch')
    const hash = createHash('sha256'); let size = 0, header = Buffer.alloc(0)
    await pipeline(createReadStream(filename), createGunzip(), new Transform({ transform(bytes, _encoding, callback) {
      if (header.length < 64) header = Buffer.concat([header, bytes.subarray(0, 64 - header.length)])
      size += bytes.length; hash.update(bytes); callback(size > asset.rawSize ? new Error('Cloud runtime size mismatch') : null)
    } }))
    if (size !== asset.rawSize || hash.digest('hex') !== asset.rawSha256) throw new Error('Cloud runtime content mismatch')
    if (header.length < 64 || header.toString('hex', 0, 4) !== '7f454c46' || header[4] !== 2 || header[5] !== 1
      || header.readUInt16LE(18) !== (architecture === 'x64' ? 62 : 183)
      || ![2, 3].includes(header.readUInt16LE(16))
      || (name.startsWith('lib') && header.readUInt16LE(16) !== 3)) throw new Error(`Invalid Linux ${architecture} ${name} ELF binary`)
  }
  for (const name of ['LICENSE.node.txt', 'NOTICE.monpm.txt', 'NOTICE.cpp.txt']) if (!(await readFile(path.join(root, name), 'utf8')).trim()) throw new Error('Missing runtime notices')
}
