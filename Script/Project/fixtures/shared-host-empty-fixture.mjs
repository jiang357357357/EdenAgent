import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const execute = promisify(execFile)
export async function emptyHostFixture(distro, node) {
  const root = `/tmp/eden-shared-empty-${randomUUID()}`
  const run = (command, args) => execute('wsl.exe', ['-d', distro, '-u', 'root', '--exec', command, ...args],
    { timeout: 30_000, encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 })
  const linuxPath = async value => (await run('wslpath', ['-u', value])).stdout.trim()
  const setup = await linuxPath(fileURLToPath(new URL('./shared-host-empty-root.py', import.meta.url)))
  let child
  try {
    await run('python3', [setup, 'create', root, node])
    const script = await linuxPath(fileURLToPath(new URL('./shared-host-ssh-server.mjs', import.meta.url)))
    const password = randomBytes(32).toString('base64url'), commands = []
    child = spawn('wsl.exe', ['-d', distro, '-u', 'root', '--exec', node, script, root], { stdio: 'pipe', windowsHide: true })
    child.stdin.on('error', () => {})
    let pending = '', errorText = ''
    child.stderr.on('data', bytes => { errorText = (errorText + bytes).slice(-4000) })
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Empty SSH fixture startup timeout')), 20_000)
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Empty SSH fixture exited ${code}: ${errorText}`)) })
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', bytes => {
        pending += bytes; let newline
        while ((newline = pending.indexOf('\n')) !== -1) {
          const text = pending.slice(0, newline); pending = pending.slice(newline + 1)
          let event; try { event = JSON.parse(text) } catch { continue }
          if (event.event === 'ssh_command') commands.push(event.command)
          if (event.event === 'ssh_fixture_ready') { clearTimeout(timer); resolve(event) }
        }
      })
      child.stdin.write(JSON.stringify({ password }) + '\n')
    })
    const address = (await run('hostname', ['-I'])).stdout.trim().split(/\s+/)[0]
    return { target: { host: address, port: ready.port, username: 'root' }, password, commands,
      exec: (command, args) => run('chroot', [root, command, ...args]),
      async readJson(remote) { return JSON.parse((await run('cat', [root + remote])).stdout) },
      async readText(remote) { return (await run('cat', [root + remote])).stdout },
      async close() { child.stdin.end(); if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => child.once('exit', resolve)); await run('python3', [setup, 'remove', root, node]) } }
  } catch (error) {
    child?.kill()
    await run('python3', [setup, 'remove', root, node]).catch(() => {})
    throw error
  }
}
