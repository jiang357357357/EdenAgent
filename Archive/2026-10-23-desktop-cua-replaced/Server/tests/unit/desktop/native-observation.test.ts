import assert from 'node:assert/strict'
import test from 'node:test'
import type { WindowStateOutput } from '@trycua/cua-driver'
import { projectNativeObservation } from '../../../src/modules/desktop/native-observation.ts'
import type { NativeWindow } from '../../../src/modules/desktop/contracts.ts'

const window: NativeWindow = { pid: 1, windowId: '1', app: 'Fixture', title: 'Fixture', minimized: false,
  bounds: { x: 400, y: 0, width: 400, height: 300 } }

test('SDK observation retains scale, quality, frames and non-actionable text without leaking tokens', () => {
  const state: WindowStateOutput = { pid: 1, windowId: 1n, images: [{ mimeType: 'image/png', dataBase64: 'AA==' }],
    windowBounds: { x: 800, y: 0, width: 800, height: 600 }, screenshotWidth: 400, screenshotHeight: 300,
    screenshotScale: 0.5, screenshotFrameValid: false, elementsComplete: false, degraded: true,
    degradedReason: 'capture_partial', truncated: true, truncationReason: 'max_depth',
    elements: [{ elementIndex: 2n, parentIndex: 1n, role: 'Text', depth: 2, label: 'readable', frame: { x: 820, y: 20, w: 100, h: 40 } }] }
  const observation = projectNativeObservation(window, state)
  assert.equal(observation.scale, 0.5); assert.equal(observation.frameValid, false)
  assert.equal(observation.degradedReason, 'capture_partial'); assert.equal(observation.elementsComplete, false)
  assert.equal(observation.truncationReason, 'max_depth'); assert.equal(observation.images.length, 1)
  assert.equal(observation.elements[0]!.label, 'readable'); assert.equal(observation.elements[0]!.token, '')
  assert.deepEqual(observation.elements[0]!.frame, { x: 820, y: 20, width: 100, height: 40 })
  assert.equal(observation.elements[0]!.parent, '1'); assert.equal(observation.elements[0]!.valueAvailable, false)
  const textOnly = projectNativeObservation(window, state, false)
  assert.equal(textOnly.screenshotIncluded, false); assert.equal(textOnly.width, 0); assert.deepEqual(textOnly.images, [])
})

test('unreported SDK metadata remains unknown and clipped values are marked', () => {
  const state: WindowStateOutput = { pid: 1, windowId: 1n, images: [], elements: [
    { elementIndex: 1n, role: 'Edit', depth: 0, elementToken: 'private', value: 'x'.repeat(16001), label: 'y'.repeat(1001) },
    { elementIndex: 2n, role: 'Edit', depth: 0, value: '' },
  ] }
  const observation = projectNativeObservation(window, state)
  assert.equal(observation.frameValid, undefined); assert.equal(observation.elementsComplete, undefined)
  assert.equal(observation.elements[0]!.value.length, 16000); assert.equal(observation.elements[0]!.valueTruncated, true)
  assert.equal(observation.elements[0]!.labelTruncated, true); assert.equal(observation.elements[1]!.valueAvailable, true)
})
