import assert from 'node:assert/strict'
import test from 'node:test'
import { computerUseDriver } from '../../../src/modules/desktop/computer-use-driver.ts'
import { DesktopError } from '../../../src/modules/desktop/contracts.ts'

const signal = () => new AbortController().signal
const window = { pid: 7, windowId: '123', app: 'fixture.exe', title: 'fixture', bounds: { x: 720, y: 200, width: 1736, height: 1280 }, minimized: false }
function fixture() {
  const calls: { action: string; args: Record<string, unknown> }[] = []
  const element = { token: 'private-element', index: '0', parent: null, role: 'Edit', label: 'Input', value: 'hello',
    enabled: true, valueAvailable: true, valueTruncated: false, labelTruncated: false, actions: ['set_value'], frame: { x: 42, y: 56, width: 60, height: 20 }, focused: true }
  const state = { window, snapshot: 'a'.repeat(32), elements: [element], images: [], width: 868, height: 640, scale: 0.5,
    frameValid: true, screenshotIncluded: true, elementsComplete: true, truncated: false, elementCoordinateSpace: 'window_screenshot_pixels',
    focusedElement: element, captureBackend: 'foreground_screen_copy', textRequested: true }
  let error: Error | undefined
  const transport = { async prepare() { return 3 }, async close() {}, async request(action: string, args: Record<string, unknown>) {
    calls.push({ action, args }); if (error) throw error
    return action === 'windows' ? [window] : action === 'observe' ? state : { status: 'delivered', route: 'global_input', effect: 'unverifiable' }
  } }
  return { driver: computerUseDriver(transport), calls, fail: (value: Error) => { error = value } }
}

test('Computer Use backend forwards capture options and keeps frame coordinates in the window screenshot', async () => {
  const f = fixture()
  assert.equal(await f.driver.prepare!(signal()), 3)
  assert.deepEqual(await f.driver.windows(signal()), [window])
  const state = await f.driver.observe(window, signal(), { screenshot: false, text: true })
  assert.equal(f.calls[1]!.args.screenshot, false); assert.equal(f.calls[1]!.args.text, true)
  assert.equal(state.elements[0]!.frame!.x, 42)
  assert.equal(state.focusedElement?.label, 'Input')
  assert.equal(state.elementCoordinateSpace, 'window_screenshot_pixels')
})

test('Computer Use never silently retries a background request in the foreground', async () => {
  const f = fixture()
  await assert.rejects(f.driver.act('click', { delivery_mode: 'background' }, signal()), (error: DesktopError) => error.code === 'BACKGROUND_UNSUPPORTED')
  assert.equal(f.calls.length, 0)
})

test('foreground dispatch is not reported as verified and focus errors are not replayed', async () => {
  const f = fixture()
  const result = await f.driver.act('click', { delivery_mode: 'foreground', x: 42, y: 56 }, signal())
  assert.equal(result.status, 'delivered'); assert.equal(result.effect, 'unverifiable')
  f.fail(new DesktopError('focus changed', 'FOCUS_CHANGED', 'unknown'))
  await assert.rejects(f.driver.act('type_text', { text: 'once' }, signal()), (error: DesktopError) => error.code === 'FOCUS_CHANGED' && error.toolOutcome === 'unknown')
  assert.equal(f.calls.length, 2)
})
