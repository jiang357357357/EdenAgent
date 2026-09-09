import path from 'node:path'
import { rollbackLegacyPair } from '../../packages/store/src/legacy/rollback-pair.ts'

const [filename, id, note, confirm] = process.argv.slice(2)
if (process.argv.length !== 6 || !filename || !id || !note || confirm !== '--confirm-joint-rollback') {
  process.stderr.write('Usage: node --import tsx Script/Project/rollback_pair.mjs <group.json> <group-id> <note> --confirm-joint-rollback\n')
  process.exitCode = 2
} else {
  try { process.stdout.write(JSON.stringify(await rollbackLegacyPair(path.resolve(filename), id, note), null, 2) + '\n') }
  catch (error) { process.stderr.write(`Joint rollback failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1 }
}
