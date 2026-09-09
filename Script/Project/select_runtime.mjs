import path from 'node:path'
import { selectRuntimeRoots, restoreRuntimeSelection } from './runtime_selection.mjs'
import reader from '../../frontend/desktop/src/processes/runtime-selection.cjs'

const [action, ...args] = process.argv.slice(2)
const count = { read: 1, select: 6, restore: 4 }[action]
if (!count || args.length !== count || args.some(value => !value) ||
  (action !== 'read' && args.at(-1) !== '--confirm-switch')) {
  process.stderr.write(`Usage:
  node --import tsx Script/Project/select_runtime.mjs read <selection.json>
  node --import tsx Script/Project/select_runtime.mjs select <selection.json> <expected-revision|none> <mon-root> <local-root> <note> --confirm-switch
  node --import tsx Script/Project/select_runtime.mjs restore <selection.json> <expected-revision> <note> --confirm-switch
Both selected runtimes must already be initialized/activated. Stop launchers and both worlds before switching.
`)
  process.exitCode = 2
} else {
  try {
    const filename = path.resolve(args[0])
    const result = action === 'read' ? reader.readRuntimeSelection(filename) : action === 'restore'
      ? await restoreRuntimeSelection(filename, args[1], args[2])
      : await selectRuntimeRoots(filename, args[1], { mon: path.resolve(args[2]), local: path.resolve(args[3]) }, args[4])
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  } catch (error) {
    process.stderr.write(`Runtime selection failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
