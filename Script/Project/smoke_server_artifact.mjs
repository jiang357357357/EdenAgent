import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { realmEnvironment } from './runtime_children.mjs'

const directory = await mkdtemp(path.join(tmpdir(), 'eden-artifact-'))
const children = []
async function launch(origin) {
  const child = spawn(process.execPath, ['dist/server/main.mjs'], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...realmEnvironment(process.env, origin, origin.repeat(16), 0), EDEN_AGENT_DATA_ROOT: path.join(directory, origin) },
  })
  children.push(child)
  const port = await new Promise((resolve, reject) => {
    let output = ''
    const timeout = setTimeout(() => reject(new Error(`${origin} startup timeout`)), 10_000)
    child.once('error', reject)
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`${origin} exited: ${code}`)) })
    child.stdout.on('data', chunk => {
      output += chunk.toString()
      const line = output.split('\n').find(value => value.includes('server.listening'))
      if (line) { clearTimeout(timeout); resolve(JSON.parse(line).port) }
    })
  })
  const response = await fetch(`http://127.0.0.1:${port}/healthz`)
  assert.equal((await response.json()).runtimeOrigin, origin)
  return port
}
try {
  const ports = await Promise.all([launch('mon'), launch('local')])
  assert.notEqual(ports[0], ports[1])
  assert.notEqual(children[0].pid, children[1].pid)
  process.stdout.write('Built artifact: two isolated Node processes passed health checks\n')
} finally {
  await Promise.all(children.map(async child => {
    if (child.exitCode !== null) return
    child.send('shutdown')
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Artifact did not shut down cleanly')) }, 3000)
      child.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`Artifact exit: ${code}`)) })
    })
  }))
  await rm(directory, { recursive: true, force: true })
}
