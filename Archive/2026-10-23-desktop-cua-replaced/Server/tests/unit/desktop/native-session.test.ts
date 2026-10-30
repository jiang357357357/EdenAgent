import test from 'node:test'
import assert from 'node:assert/strict'
import { nativeSdkFixture, FixtureDriverError } from '../../helpers/desktop-native-sdk.ts'
import { DesktopError } from '../../../src/modules/desktop/contracts.ts'

const signal = () => new AbortController().signal
const window = { pid: 1, windowId: '1', app: 'Fixture', title: 'Fixture 1', bounds: { x: 400, y: 0, width: 400, height: 300 }, minimized: false }

test('one named session is renewed for reads and input, then revived after five idle minutes', async () => {
  const f = nativeSdkFixture(), s = signal()
  try {
    assert.equal(await f.driver.prepare!(s), 1)
    const observation = await f.driver.observe(window, s)
    await f.driver.act('click', { session: 'must-not-override', pid: 1 }, s)
    assert.equal(await f.driver.prepare!(s), 1)
    assert.equal(new Set(f.starts).size, 1)
    assert.equal(f.observations[0]!.session, f.starts[0])
    assert.equal(f.actions[0]!.args.session, f.starts[0])
    assert.ok(observation.elements.length)
    f.idle()
    assert.equal(await f.driver.prepare!(s), 2)
    await f.driver.observe(window, s)
    assert.equal(f.actions.length, 1, 'recovery did not repeat the previous click')
    assert.equal((await f.driver.screenSize!(s)).width, 1920)
  } finally { await f.driver.close() }
  assert.deepEqual(f.cleanup, { ended: 1, shutdown: 1, destroyed: 1 })
})

test('native observation errors retain their code, failed outcome and recovery guidance', async () => {
  const f = nativeSdkFixture(), s = signal()
  try {
    await f.driver.prepare!(s)
    f.failObserve(new FixtureDriverError('capture_failed'))
    await assert.rejects(f.driver.observe(window, s), error => {
      assert.ok(error instanceof DesktopError)
      assert.equal(error.code, 'capture_failed'); assert.equal(error.toolOutcome, 'failed')
      assert.equal(error.diagnostics?.operation, 'get_window_state')
      assert.equal(error.cause instanceof FixtureDriverError, true)
      return true
    })
    f.failObserve(new FixtureDriverError('session_ended'))
    await assert.rejects(f.driver.observe(window, s), /会话已结束/)
    f.failObserve(undefined)
    assert.equal(await f.driver.prepare!(s), 2)
  } finally { await f.driver.close() }
})

test('ended and uncertain input failures are never retried or reported as successful', async () => {
  const f = nativeSdkFixture(), s = signal()
  try {
    await f.driver.prepare!(s)
    f.refuseAction(true)
    const refused = await f.driver.act('type_text', { pid: 1, text: 'once' }, s)
    assert.equal(refused.code, 'session_ended'); assert.equal(refused.status, 'refused')
    assert.equal(f.actions.length, 1)
    f.refuseAction(false)
    assert.equal(await f.driver.prepare!(s), 2)
    f.failAction(new FixtureDriverError('transport_failed'))
    await assert.rejects(f.driver.act('type_text', { pid: 1, text: 'once' }, s), error => {
      assert.ok(error instanceof DesktopError)
      assert.equal(error.toolOutcome, 'unknown'); assert.equal(error.code, 'transport_failed')
      return true
    })
    assert.equal(f.actions.length, 2)
  } finally { await f.driver.close() }
})

test('failed or cancelled session preparation blocks native reads and input', async () => {
  const f = nativeSdkFixture(), controller = new AbortController()
  try {
    f.failStart(new FixtureDriverError('session_ended'))
    await assert.rejects(f.driver.prepare!(controller.signal), /会话已结束/)
    assert.equal(f.observations.length, 0); assert.equal(f.actions.length, 0)
    f.failStart(undefined)
    const cancelled = new DesktopError('已暂停', 'DESKTOP_PAUSED', 'cancelled')
    f.duringStart(() => controller.abort(cancelled))
    await assert.rejects(f.driver.prepare!(controller.signal), error => error === cancelled)
    assert.equal(f.actions.length, 0)
  } finally { await f.driver.close() }
})

test('unsafe native codes are normalized while the underlying error remains available internally', async () => {
  const f = nativeSdkFixture(), s = signal()
  try {
    await f.driver.prepare!(s)
    f.failObserve(new FixtureDriverError('invalid code; payload=private'))
    await assert.rejects(f.driver.observe(window, s), error => {
      assert.ok(error instanceof DesktopError)
      assert.equal(error.code, 'DRIVER_CALL_FAILED')
      assert.doesNotMatch(error.message, /payload=/)
      return true
    })
  } finally { await f.driver.close() }
})

test('closing an unused adapter releases the transport without ending an uncreated native session', async () => {
  const f = nativeSdkFixture()
  await f.driver.close()
  assert.deepEqual(f.cleanup, { ended: 0, shutdown: 1, destroyed: 1 })
})

test('structured native read failures retain the session error rather than failing JSON validation', async () => {
  const f = nativeSdkFixture(), s = signal()
  try {
    await f.driver.prepare!(s)
    f.failScreenResult('session_ended')
    await assert.rejects(f.driver.screenSize!(s), error => {
      assert.ok(error instanceof DesktopError)
      assert.equal(error.code, 'session_ended'); assert.equal(error.toolOutcome, 'failed')
      return true
    })
    f.failScreenResult(undefined)
    assert.equal(await f.driver.prepare!(s), 2)
    assert.equal((await f.driver.screenSize!(s)).width, 1920)
  } finally { await f.driver.close() }
})
