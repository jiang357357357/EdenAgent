import { activateLegacyImport } from '../../packages/store/src/legacy/activation.ts'
import { rollbackLegacyActivation } from '../../packages/store/src/legacy/activation-rollback.ts'

const [action, ...args] = process.argv.slice(2)
const activate = action === 'activate', rollback = action === 'rollback'
const origin = args[activate ? 2 : 1]
if ((!activate && !rollback) || args.length !== (activate ? 4 : 5) || !['mon', 'local'].includes(origin) ||
    args.some(value => !value) || (rollback && args[4] !== '--confirm-rollback')) {
  process.stderr.write(`Usage:
  node --import tsx Script/Project/activate_legacy.mjs activate <snapshot> <staging-directory> <mon|local> <confirmation.json>
  node --import tsx Script/Project/activate_legacy.mjs rollback <staging-directory> <mon|local> <activation-id> <note> --confirm-rollback
No process is started, no old database is overwritten, and rollback does not undo external effects.
`)
  process.exitCode = 2
} else {
  try {
    const result = activate ? await activateLegacyImport(args[0], args[1], origin, args[3]) :
      await rollbackLegacyActivation(args[0], origin, args[2], args[3])
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  } catch (error) {
    process.stderr.write(`Legacy activation failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
