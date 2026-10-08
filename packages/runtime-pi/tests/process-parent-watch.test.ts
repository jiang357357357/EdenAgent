import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'

test('a busy child exits after its supervising host dies, without depending on its blocked event loop', { timeout: 15_000 }, async t => {
  const host = fork(new URL('./process-parent-fixture.ts', import.meta.url), [], {
    execArgv: ['--import', import.meta.resolve('tsx')], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
  let childPid: number | undefined
  t.after(() => {
    host.kill()
    if (childPid) try { process.kill(childPid) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
  })
  const [message] = await once(host, 'message') as [{ ready: boolean; pid: number }]
  assert.equal(message.ready, true)
  childPid = message.pid
  await delay(400)
  const exited = once(host, 'exit')
  host.kill('SIGKILL')
  await exited
  let alive = true
  for (let attempt = 0; alive && attempt < 50; attempt++) {
    try { process.kill(childPid, 0) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false; else throw error }
    if (alive) await delay(100)
  }
  assert.equal(alive, false)
  childPid = undefined
})
