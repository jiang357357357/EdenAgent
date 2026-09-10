import { inflateRawSync } from 'node:zlib'
/** Decode a bounded ZIP into memory; never write attacker-supplied archive paths to disk. */
export function readPackageZip(bytes: Buffer): Map<string, Buffer> {
  if (bytes.length > 72 * 1024 * 1024 || bytes.length < 22) throw new Error('Invalid plugin archive size')
  const { start, count, end } = zipDirectory(bytes)
  const result = new Map<string, Buffer>(), paths = new Set<string>()
  let cursor = start, total = 0
  for (let index = 0;index < count;index++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP directory entry')
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10)
    const compressed = bytes.readUInt32LE(cursor + 20), length = bytes.readUInt32LE(cursor + 24)
    const nameLength = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32)
    const mode = bytes.readUInt32LE(cursor + 38) >>> 16, local = bytes.readUInt32LE(cursor + 42)
    if (cursor + 46 + nameLength + extra + comment > end || bytes.readUInt16LE(cursor + 34) !== 0) throw new Error('ZIP entry exceeds directory')
    const { rawName, directory, name } = zipEntryPath(bytes, cursor, nameLength, flags, method, mode, paths)
    const dataStart = zipEntryDataOffset(local, start, bytes, method, flags, compressed, rawName)
    if (length > 64 * 1024 * 1024 || total + length > 64 * 1024 * 1024) throw new Error('Plugin extracted size exceeds 64 MiB')
    total = extractZipEntry(directory, length, compressed, bytes, dataStart, method, total, result, name)
    cursor += 46 + nameLength + extra + comment
  }
  if (cursor !== end || !result.has('plugin.json')) throw new Error('Archive must contain plugin.json at its root')
  for (const name of result.keys()) {
    const parts = name.split('/')
    for (let index = 1;index < parts.length;index++) if (result.has(parts.slice(0, index).join('/'))) throw new Error('ZIP path is both a file and directory')
  }
  return result
}

function extractZipEntry(directory: boolean, length: number, compressed: number, bytes: Buffer<ArrayBufferLike>, dataStart: number, method: number, total: number, result: Map<string, Buffer<ArrayBufferLike>>, name: string) {
  if (directory) { if (length || compressed) throw new Error('ZIP directory contains data') }
  else {
    const encoded = bytes.subarray(dataStart, dataStart + compressed)
    const data = method === 0 ? Buffer.from(encoded) : inflateRawSync(encoded, { maxOutputLength: Math.max(1, length) })
    if (data.length !== length) throw new Error('ZIP decompressed size mismatch')
    total += data.length
    result.set(name, data)
  }
  return total
}

function zipEntryDataOffset(local: number, start: number, bytes: Buffer<ArrayBufferLike>, method: number, flags: number, compressed: number, rawName: Buffer<ArrayBufferLike>) {
  if (local + 30 > start || bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 8) !== method || bytes.readUInt16LE(local + 6) !== flags) throw new Error('ZIP local header differs from directory')
  const localNameLength = bytes.readUInt16LE(local + 26), localExtra = bytes.readUInt16LE(local + 28)
  const dataStart = local + 30 + localNameLength + localExtra
  if (dataStart > start || dataStart + compressed > start || !bytes.subarray(local + 30, local + 30 + localNameLength).equals(rawName)) throw new Error('ZIP entry data is out of bounds')
  return dataStart
}

function zipEntryPath(bytes: Buffer<ArrayBufferLike>, cursor: number, nameLength: number, flags: number, method: number, mode: number, paths: Set<string>) {
  const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength)
  const name = new TextDecoder('utf-8', { fatal: true }).decode(rawName)
  if (!name || name.length > 1024 || name.startsWith('/') || /[\\:\x00-\x1f]/.test(name) || name.split('/').some(part => part === '..' || part === '.')) throw new Error('Unsafe ZIP entry path')
  if ((flags & 1) || ![0, 8].includes(method) || (mode & 0xf000) === 0xa000) throw new Error('Encrypted, linked or unsupported ZIP entry')
  if ((mode & 0xf000) && ![0x8000, 0x4000].includes(mode & 0xf000)) throw new Error('ZIP contains a special file')
  const directory = name.endsWith('/'), canonical = directory ? name.slice(0, -1) : name
  if (!canonical || paths.has(canonical) || canonical.split('/').includes('')) throw new Error('Duplicate or ambiguous ZIP path')
  paths.add(canonical)
  return { rawName, directory, name }
}

function zipDirectory(bytes: Buffer<ArrayBufferLike>) {
  let end = -1
  for (let at = bytes.length - 22;at >= Math.max(0, bytes.length - 65557);at--) {
    if (bytes.readUInt32LE(at) === 0x06054b50 && at + 22 + bytes.readUInt16LE(at + 20) === bytes.length) { end = at; break }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw new Error('ZIP must be a single-disk archive')
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16)
  if (count !== bytes.readUInt16LE(end + 8) || count > 520 || start + size !== end) throw new Error('ZIP directory is invalid or exceeds limits')
  return { start, count, end }
}
