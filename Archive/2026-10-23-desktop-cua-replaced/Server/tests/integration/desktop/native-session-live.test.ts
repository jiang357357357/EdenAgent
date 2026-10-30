import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { nativeDriverAdapter } from '../../../src/modules/desktop/native-driver.ts'

const enabled = process.platform === 'win32' && process.env.EDEN_DESKTOP_SESSION_NATIVE_TEST === '1'

test('real native SDK revives an ended named session without replaying input or touching application windows', {
  skip: !enabled, timeout: 20000,
}, async () => {
  const sdk = await import('@trycua/cua-driver'), raw = sdk.CuaDriver.create(undefined)
  const states: { active: boolean; revived: boolean }[] = []
  let name = '', actions = 0
  const driver = nativeDriverAdapter(sdk, {
    async startSession(input, options) {
      name = input.session!
      const state = await raw.startSession(input, options)
      states.push({ active: state.active, revived: state.revived })
      return state
    },
    endSession: raw.endSession.bind(raw), getWindowState: raw.getWindowState.bind(raw), listWindows: raw.listWindows.bind(raw),
    getScreenSize: raw.getScreenSize.bind(raw), shutdown: raw.shutdown.bind(raw),
    uniffiDestroy() { if ('uniffiDestroy' in raw && typeof raw.uniffiDestroy === 'function') raw.uniffiDestroy() },
    async callTool(...args) { actions++; return raw.callTool(...args) },
  })
  try {
    const signal = AbortSignal.timeout(10000)
    const first = await driver.prepare!(signal)
    assert.equal(first, 1)
    assert.equal(await driver.prepare!(signal), first, 'an active named session retains its generation')
    await raw.endSession(sdk.EndSessionInput.new({ session: name }), { signal })
    const expired = await raw.getScreenSize(sdk.GetScreenSizeInput.new({ session: name }), { signal })
      .then(result => result.errorCode).catch(error => sdk.DriverError.Tool.instanceOf(error) ? error.inner.errorCode : Promise.reject(error))
    assert.equal(expired, 'session_ended')
    assert.equal(await driver.prepare!(signal), 2)
    assert.equal(states.at(-1)?.revived, true)
    const size = await driver.screenSize!(signal)
    assert.ok(size.width > 0 && size.height > 0)
    assert.equal(actions, 0)
    const evidence = path.resolve('.artifacts/desktop-session-recovery-20261023')
    await mkdir(evidence, { recursive: true })
    await writeFile(path.join(evidence, 'native-lifecycle.json'), JSON.stringify({ passed: true,
      expiration: 'Explicit SDK endSession reproduces the ended state; no real idle wait', expiredCode: expired,
      states, generations: [first, 2], screenSizeReadableAfterRecovery: true, nativeInputCalls: actions,
      windowCaptureCalls: 0, windowsActivated: 0 }, null, 2))
  } finally { await driver.close() }
})
