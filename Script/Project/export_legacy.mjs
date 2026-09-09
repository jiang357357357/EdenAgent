import { exportLegacySnapshot } from '../../packages/store/src/legacy/snapshot.ts'

const [source, destination, origin, ...extra] = process.argv.slice(2)
if (!source || !destination || !['mon', 'local'].includes(origin) || extra.length) {
  process.stderr.write('Usage: node --import tsx Script/Project/export_legacy.mjs <legacy.sqlite> <new-snapshot-directory> <mon|local>\n')
  process.exitCode = 2
} else {
  try {
    const report = await exportLegacySnapshot(source, destination, origin)
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  } catch (error) {
    process.stderr.write(`Legacy export failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
