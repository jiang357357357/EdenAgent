import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const built = process.argv[2] === '--built'
if (process.argv.length > 3 || (process.argv[2] && !built)) throw new Error('Usage: start_server.mjs [--built]')
const origin = process.env.EDEN_AGENT_RUNTIME_ORIGIN ?? 'local'
if (!['mon', 'local'].includes(origin)) throw new Error('Unsupported runtime origin')
const dataRoot = path.resolve(process.env.EDEN_AGENT_DATA_ROOT
  ?? process.env[origin === 'mon' ? 'EDEN_AGENT_MON_DATA_ROOT' : 'EDEN_AGENT_LOCAL_DATA_ROOT']
  ?? path.join(root, 'Data', 'realms', origin))
const environment = { ...process.env, EDEN_AGENT_DATA_ROOT: dataRoot }
const child = spawn(process.execPath, built ? ['dist/server/main.mjs'] : ['--import', 'tsx', 'Server/src/main.ts'], {
  cwd: root, env: environment, stdio: 'inherit',
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('error', error => { process.stderr.write(`Server launch failed: ${error.message}\n`); process.exitCode = 1 })
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
