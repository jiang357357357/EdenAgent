import assert from 'node:assert/strict'
import test from 'node:test'
import { ComputerUseTransport } from '../../../src/modules/desktop/computer-use-transport.ts'
import { computerUseDriver } from '../../../src/modules/desktop/computer-use-driver.ts'

test('real compiled Computer Use backend lists native windows without capture, activation or input', { skip: process.platform !== 'win32' }, async t => {
  const transport = new ComputerUseTransport(); t.after(() => transport.close())
  const driver = computerUseDriver(transport), signal = new AbortController().signal
  const generation = await driver.prepare!(signal)
  const windows = await driver.windows(signal)
  assert.ok(generation > 0)
  assert.ok(windows.every(window => window.pid > 0 && /^\d+$/.test(window.windowId)))
  assert.equal(await driver.prepare!(signal), generation)
  t.diagnostic(JSON.stringify({ backend: 'eden.computer-use.windows.v1', windows: windows.length, nativeInputPerformed: false, screenshotCaptured: false }))
})
