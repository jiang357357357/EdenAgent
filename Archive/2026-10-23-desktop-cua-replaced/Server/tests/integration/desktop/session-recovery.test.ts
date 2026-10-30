import test from 'node:test'
import assert from 'node:assert/strict'
import { desktopFixture } from './fixture.ts'
import { nativeSdkFixture, FixtureDriverError } from '../../helpers/desktop-native-sdk.ts'
import { DesktopError } from '../../../src/modules/desktop/contracts.ts'

test('broker recovery invalidates stale snapshots in both worlds before any native input', async t => {
  const f = await desktopFixture(); t.after(() => f.close())
  const native = nativeSdkFixture(); Object.assign(f.driver, native.driver)
  const a = f.account('mon'), b = f.account('local')
  a.permissions.setMode('full_access'); b.permissions.setMode('full_access')
  const first = (await a.call('desktop_list_windows', {})).windows[0].window
  const second = (await b.call('desktop_list_windows', {})).windows[0].window
  const observedA = await a.call('desktop_observe', { window: first }), observedB = await b.call('desktop_observe', { window: second })
  native.idle()
  await assert.rejects(a.call('desktop_type', { window: first, element: observedA.elements[0].element, text: 'do not replay', mode: 'replace' }), /先观察/)
  await assert.rejects(b.call('desktop_type', { window: second, element: observedB.elements[0].element, text: 'do not replay', mode: 'replace' }), /先观察/)
  await assert.rejects(a.call('desktop_window', { window: first, action: 'activate' }), /重新观察/)
  assert.equal(native.actions.length, 0)
  const fresh = await a.call('desktop_observe', { window: first })
  const typed = await a.call('desktop_type', { window: first, element: fresh.elements[0].element, text: 'fresh input', mode: 'replace' })
  assert.equal(typed.status, 'verified')
  assert.equal(native.actions.length, 1)
  assert.equal(native.actions[0]!.args.value, 'fresh input')
  await assert.rejects(b.call('desktop_type', { window: second, element: observedB.elements[0].element, text: 'still stale', mode: 'replace' }), /先观察/)
  assert.equal(new Set(native.starts).size, 1)
})

test('mid-request ended sessions are recorded without replay and the next observation recovers them', async t => {
  const f = await desktopFixture(); t.after(() => f.close())
  const native = nativeSdkFixture(); Object.assign(f.driver, native.driver)
  const a = f.account(); a.permissions.setMode('full_access')
  const window = (await a.call('desktop_list_windows', {})).windows[0].window
  await a.call('desktop_observe', { window })
  native.refuseAction(true)
  const result = await a.call('desktop_window', { window, action: 'activate' })
  assert.equal(result.code, 'session_ended'); assert.equal(result.status, 'refused')
  assert.equal(native.actions.length, 1)
  native.refuseAction(false)
  assert.ok((await a.call('desktop_observe', { window })).elements.length)
  assert.equal(native.actions.length, 1, 'observation and recovery did not repeat activation')
  const row = a.database.connection.prepare("SELECT state,result_json FROM desktop_operations WHERE action='desktop_window'").get()!
  assert.equal(row.state, 'failed')
  assert.equal(JSON.parse(String(row.result_json)).code, 'session_ended')
})

test('observation error codes survive native adapter, broker, model tool and audit storage', async t => {
  const f = await desktopFixture(); t.after(() => f.close())
  const native = nativeSdkFixture(); Object.assign(f.driver, native.driver)
  const a = f.account(); a.permissions.setMode('full_access')
  const window = (await a.call('desktop_list_windows', {})).windows[0].window
  native.failObserve(new FixtureDriverError('capture_failed'))
  await assert.rejects(a.call('desktop_observe', { window }), error => {
    assert.ok(error instanceof DesktopError)
    assert.equal(error.code, 'capture_failed'); assert.equal(error.toolOutcome, 'failed')
    assert.match(error.message, /capture_failed/)
    assert.equal(error.diagnostics?.operation, 'get_window_state')
    return true
  })
  const row = a.database.connection.prepare("SELECT state,result_json,error FROM desktop_operations WHERE action='desktop_observe'").get()!
  assert.equal(row.state, 'failed')
  assert.equal(JSON.parse(String(row.result_json)).code, 'capture_failed')
  assert.match(String(row.error), /capture_failed/)
  native.failObserve(undefined)
  assert.ok((await a.call('desktop_observe', { window })).elements.length)
})
