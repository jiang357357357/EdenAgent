import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { acquireProcessLock } from '../src/bootstrap/process-lock.ts'

test('process ownership excludes another owner and recovers automatically after SIGKILL', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'eden-owner-'))
  const child = fork(new URL('./fixtures/lock-owner.ts', import.meta.url), [directory], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  try {
    await once(child, 'message')
    assert.throws(() => acquireProcessLock(directory), /locked/)
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
    const release = acquireProcessLock(directory)
    assert.throws(() => acquireProcessLock(directory), /locked/)
    release()
    acquireProcessLock(directory)()
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); rmSync(directory, { recursive: true }) }
})
