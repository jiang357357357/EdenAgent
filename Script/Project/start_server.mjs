import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import realmRoots from '../../frontend/desktop/src/processes/realm-data-roots.cjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const origin = process.env.EDEN_AGENT_RUNTIME_ORIGIN ?? 'local'
if (!['mon', 'local'].includes(origin)) throw new Error('Unsupported runtime origin')
const { roots: dataRoots, selection } = realmRoots.resolveRealmSelection(process.env, {
  mon: path.join(root, 'Data/realms/mon/v2'), local: path.join(root, 'Data/realms/local/v2'),
})
if (selection && process.env.EDEN_AGENT_V2_DATA_ROOT && path.resolve(process.env.EDEN_AGENT_V2_DATA_ROOT) !== dataRoots[origin]) throw new Error('Single-host data root conflicts with runtime selection')
const environment = { ...process.env, EDEN_AGENT_V2_DATA_ROOT: process.env.EDEN_AGENT_V2_DATA_ROOT ?? dataRoots[origin],
  ...(selection ? { EDEN_AGENT_RUNTIME_SELECTION_REVISION: selection.revision } : {}) }
const child = spawn(process.execPath, ['--import', 'tsx', 'Server/src/main.ts'], {
  cwd: root, env: environment, stdio: 'inherit',
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('error', error => { process.stderr.write(`Server launch failed: ${error.message}\n`); process.exitCode = 1 })
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
