import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { generateKeyPairSync } from 'node:crypto'
import { spawn } from 'node:child_process'
import ssh2 from 'ssh2'
import { serveHostSftp } from './shared-host-sftp.mjs'

const root = process.argv[2]
if (!/^\/tmp\/eden-shared-empty-[a-f0-9-]{36}$/.test(root)) throw new Error('Invalid disposable root')
const input = createInterface({ input: process.stdin })
const [first] = await once(input, 'line'), setup = JSON.parse(first)
const clients = new Set(), children = new Set()
const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' })
const server = new ssh2.Server({ hostKeys: [key] }, client => {
  clients.add(client); client.once('close', () => clients.delete(client)); client.on('error', () => {})
  client.on('authentication', context => {
    if (context.method === 'password' && context.username === 'root' && context.password === setup.password) context.accept()
    else context.reject()
  })
  client.on('session', accept => {
    const session = accept()
    session.on('sftp', acceptSftp => serveHostSftp(acceptSftp(), root))
    session.on('exec', (acceptExec, _reject, request) => {
      process.stdout.write(JSON.stringify({ event: 'ssh_command', command: request.command }) + '\n')
      const stream = acceptExec(), child = spawn('chroot', [root, '/bin/sh', '-c', request.command], {
        stdio: 'pipe', env: { HOME: '/root', USER: 'root', PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8' },
      })
      children.add(child); stream.pipe(child.stdin); child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream.stderr)
      child.stdin.on('error', () => {})
      child.once('close', code => { children.delete(child); stream.exit(code ?? 1); stream.end() })
      stream.once('close', () => child.kill())
    })
  })
})
server.listen(0, '0.0.0.0'); await once(server, 'listening')
process.stdout.write(JSON.stringify({ event: 'ssh_fixture_ready', port: server.address().port }) + '\n')
await once(input, 'close')
for (const child of children) child.kill()
for (const client of clients) client.end()
await new Promise(resolve => server.close(resolve))
