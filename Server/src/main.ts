import { loadConfig } from './bootstrap/config.ts'
import { startServer } from './bootstrap/container.ts'

const config = loadConfig()
const server = await startServer(config)
process.stdout.write(JSON.stringify({ event: 'server.listening', origin: config.origin, host: config.host, port: server.port,
  mode: config.migrationReview ? 'migration-review' : 'runtime' }) + '\n')
let stopping = false
const shutdown = () => {
  if (stopping) return
  stopping = true
  const deadline = setTimeout(() => { process.stderr.write('Shutdown deadline exceeded\n'); process.exit(1) }, 10_000)
  deadline.unref()
  void server.close().then(() => { clearTimeout(deadline); if (process.connected) process.disconnect() }, error => {
    process.stderr.write(`Shutdown failed: ${error instanceof Error ? error.message : 'unknown'}\n`)
    process.exitCode = 1
  })
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
process.on('message', message => { if (message === 'shutdown') shutdown() })
