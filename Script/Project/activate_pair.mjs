import { open } from 'node:fs/promises'
import path from 'node:path'
import { activateLegacyPair } from '../../packages/store/src/legacy/activate-pair.ts'

const [groupFile, requestFile, confirmation] = process.argv.slice(2)
if (process.argv.length !== 5 || !groupFile || !requestFile || confirmation !== '--confirm-joint-activation') {
  process.stderr.write('Usage: node --import tsx Script/Project/activate_pair.mjs <group.json> <request.json> --confirm-joint-activation\n')
  process.exitCode = 2
} else {
  try {
    const file = await open(requestFile, 'r')
    let raw
    try {
      const info = await file.stat()
      if (!info.isFile() || info.size > 32768) throw new Error('Joint activation request must be a regular JSON file of at most 32 KiB')
      const buffer = Buffer.alloc(32769), { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      if (bytesRead !== info.size) throw new Error('Joint activation request changed during reading')
      raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)))
    } finally { await file.close() }
    process.stdout.write(JSON.stringify(await activateLegacyPair(path.resolve(groupFile), raw), null, 2) + '\n')
  } catch (error) {
    process.stderr.write(`Joint activation failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
