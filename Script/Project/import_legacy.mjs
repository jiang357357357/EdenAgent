import { stageLegacySessions } from '../../packages/store/src/legacy/stage-sessions.ts'
import { resumeLegacyConversion } from '../../packages/store/src/legacy/resume-conversion.ts'
import { readLegacyConversionStatus } from '../../packages/store/src/legacy/conversion-status.ts'

const [action, ...args] = process.argv.slice(2)
const usage = `Usage:
  node --import tsx Script/Project/import_legacy.mjs stage <snapshot> <new-staging-directory> <mon|local> [legacy-blob-root]
  node --import tsx Script/Project/import_legacy.mjs resume <snapshot> <staging-directory> <mon|local> [legacy-blob-root]
  node --import tsx Script/Project/import_legacy.mjs status <staging-directory> <mon|local>
Exit codes: 0 complete, 1 failure, 2 invalid arguments, 3 incomplete conversion.
`
const status = action === 'status'
const origin = args[status ? 1 : 2]
if (!['stage', 'resume', 'status'].includes(action) || !['mon', 'local'].includes(origin) ||
    (status ? args.length !== 2 : args.length < 3 || args.length > 4) || args.some(value => !value)) {
  process.stderr.write(usage)
  process.exitCode = 2
} else {
  try {
    const report = status ? await readLegacyConversionStatus(args[0], origin) :
      await (action === 'stage' ? stageLegacySessions : resumeLegacyConversion)(args[0], args[1], origin, args[3])
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    process.exitCode = report.state === 'complete' ? 0 : 3
  } catch (error) {
    const errors = error instanceof AggregateError ? error.errors : [error]
    for (const cause of errors) process.stderr.write(`Legacy import failed: ${cause instanceof Error ? cause.message : String(cause)}\n`)
    process.exitCode = 1
  }
}
