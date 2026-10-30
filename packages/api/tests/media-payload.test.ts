import assert from 'node:assert/strict'
import test from 'node:test'
import { redactCredentialJson, redactCredentialText } from '../src/credential-redaction.ts'

test('text projection preserves binary payloads but still processes adjacent structured text', () => {
  const data = 'QUJDREVGR0g=', known = ['QUJDREVGR0g', 'image/png']
  const media = [{ type: 'image', mimeType: 'image/png', data, description: known[0]! },
    { type: 'audio', mimeType: 'audio/wav', data }, { type: 'file', mimeType: 'application/pdf', blob: data },
    { content_base64: data, note: known[0]! }, { input_audio: { data, format: 'wav' } }]
  const projected = redactCredentialJson(media, known, false) as typeof media
  assert.equal(projected[0]!.data, data); assert.equal(projected[0]!.mimeType, 'image/png')
  assert.equal(projected[0]!.description, '[已隐藏凭据]'); assert.equal(projected[1]!.data, data)
  assert.equal(projected[2]!.blob, data); assert.equal(projected[3]!.content_base64, data)
  assert.equal(projected[4]!.input_audio?.data, data)
  assert.deepEqual(JSON.parse(redactCredentialText(JSON.stringify(media), known)), projected)
})

test('standalone and embedded inline media remain byte-identical while surrounding prose is projected', () => {
  const uri = 'data:image/png;base64,QUJDREVGR0g='
  assert.equal(redactCredentialText(uri, ['QUJDREVGR0g']), uri)
  assert.equal(redactCredentialText(`说明 QUJDREVGR0g；图片 ${uri} 结束`, ['QUJDREVGR0g']), `说明 [已隐藏凭据]；图片 ${uri} 结束`)
  const nested = { image_url: { url: uri }, caption: 'QUJDREVGR0g' }
  const result = JSON.parse(redactCredentialText(JSON.stringify(nested), ['QUJDREVGR0g']))
  assert.equal(result.image_url.url, uri); assert.equal(result.caption, '[已隐藏凭据]')
})
