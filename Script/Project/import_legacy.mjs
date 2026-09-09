import { stageLegacySessions } from '../../packages/store/src/legacy/stage-sessions.ts'
import { resumeLegacyConversion } from '../../packages/store/src/legacy/resume-conversion.ts'
import { readLegacyConversionStatus } from '../../packages/store/src/legacy/conversion-status.ts'
import { exportLegacyContextReview, applyLegacyContextSummary } from '../../packages/store/src/legacy/context-review.ts'

const [action, ...args] = process.argv.slice(2)
const usage = `Usage:
  node --import tsx Script/Project/import_legacy.mjs stage <snapshot> <new-staging-directory> <mon|local> [legacy-blob-root|-] [legacy-plugin-versions-root]
  node --import tsx Script/Project/import_legacy.mjs resume <snapshot> <staging-directory> <mon|local> [legacy-blob-root|-] [legacy-plugin-versions-root]
  node --import tsx Script/Project/import_legacy.mjs status <staging-directory> <mon|local>
  node --import tsx Script/Project/import_legacy.mjs review-context <staging-directory> <mon|local> <session-id> <new-output.ndjson>
  node --import tsx Script/Project/import_legacy.mjs apply-context-summary <staging-directory> <mon|local> <session-id> <summary.json>
Exit codes: 0 complete, 1 failure, 2 invalid arguments, 3 incomplete conversion.
`
const status = action === 'status'
const context = ['review-context', 'apply-context-summary'].includes(action)
const origin = args[status || context ? 1 : 2]
if (!['stage', 'resume', 'status', 'review-context', 'apply-context-summary'].includes(action) || !['mon', 'local'].includes(origin) ||
    (context ? args.length !== 4 : status ? args.length !== 2 : args.length < 3 || args.length > 5) || args.some(value => !value)) {
  process.stderr.write(usage)
  process.exitCode = 2
} else {
  try {
    const report = context ? await (action === 'review-context' ? exportLegacyContextReview : applyLegacyContextSummary)(args[0], origin, args[2], args[3]) :
      status ? await readLegacyConversionStatus(args[0], origin) :
      await (action === 'stage' ? stageLegacySessions : resumeLegacyConversion)(args[0], args[1], origin, args[3] === '-' ? undefined : args[3], args[4])
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    process.exitCode = action === 'review-context' || report.state === 'complete' ? 0 : 3
  } catch (error) {
    const errors = error instanceof AggregateError ? error.errors : [error]
    for (const cause of errors) process.stderr.write(`Legacy import failed: ${cause instanceof Error ? cause.message : String(cause)}\n`)
    process.exitCode = 1
  }
}
