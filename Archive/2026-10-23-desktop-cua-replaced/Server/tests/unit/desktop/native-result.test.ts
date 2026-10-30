import assert from 'node:assert/strict'
import test from 'node:test'
import type { ToolResult } from '@trycua/cua-driver'
import { projectDriverAction } from '../../../src/modules/desktop/native-driver.ts'

const result = (value: Partial<ToolResult>): ToolResult => ({ text: '', images: [], isError: false, degraded: false, rawJson: '{}', ...value })
test('partial or unverifiable input is never reported as safely refused, including tool errors', () => {
  for (const effect of [1, 2, 3]) assert.equal(projectDriverAction(result({ isError: true, action: { effect, route: 1 } })).status, 'unknown')
  assert.equal(projectDriverAction(result({ isError: true, errorCode: 'background_unavailable' })).status, 'refused')
  assert.equal(projectDriverAction(result({ action: { effect: 0, route: 0 } })).status, 'verified')
  assert.equal(projectDriverAction(result({})).status, 'delivered')
})

test('native uncertainty categories, route and safe error codes survive without native identifiers', () => {
  const messages = new Set<string>()
  for (const [effect, name] of [[1, 'partial'], [2, 'unverifiable'], [3, 'suspected_noop']] as const) {
    const projected = projectDriverAction(result({ action: { effect, route: 2 }, errorCode: 'background_unavailable',
      rawJson: '{"pid":123,"window_id":456,"private":"do-not-expose"}' }))
    assert.equal(projected.status, 'unknown'); assert.equal(projected.effect, name); assert.equal(projected.route, 'global_input')
    assert.equal(projected.code, 'background_unavailable'); messages.add(projected.message)
    assert.doesNotMatch(JSON.stringify(projected), /do-not-expose|window_id|123|456/)
  }
  assert.equal(messages.size, 3)
  assert.equal(projectDriverAction(result({ isError: true, errorCode: 'pid=private;token=secret' })).code, 'DRIVER_REFUSED')
})
