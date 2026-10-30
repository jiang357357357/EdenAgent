import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stopMonpmDaemon } from '../host/boot-service.mjs'

test('managed daemon shutdown addresses only its exact configuration', async () => {
  const calls = []
  await stopMonpmDaemon('/private/monpm', '/private/service.json', async (...args) => { calls.push(args) })
  assert.deepEqual(calls, [['/private/monpm', ['daemon', 'shutdown', '-config', '/private/service.json']]])
})
for (const reason of ['no such file or directory', 'connection refused']) {
  test(`first installation can register a boot service when daemon IPC reports ${reason}`, async () => {
    await stopMonpmDaemon('/private/monpm', '/private/service.json', async () => {
      throw Object.assign(new Error('exit 1'), { stderr: `dial unix /run/user/1000/monpm/ours.sock: connect: ${reason}\n` })
    })
  })
}
test('daemon shutdown permission, timeout and executable errors remain failures', async () => {
  for (const stderr of ['dial unix /run/ours.sock: connect: permission denied\n', '', 'unrelated no such file or directory']) {
    const error = Object.assign(new Error('failure'), { stderr })
    await assert.rejects(stopMonpmDaemon('/private/monpm', '/private/service.json', async () => { throw error }), value => value === error)
  }
})
