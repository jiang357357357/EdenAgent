import type { JsonValue } from './json.ts'
import { mapJsonText } from './json-text-projection.ts'
import type { JsonTextProjector } from './json-text-projection.ts'
import { isRuntimeProtocolField, isSignedThinking } from './runtime-protocol-fields.ts'
import { isMediaPayloadField } from './media-payload.ts'

export const credentialHidden = '[已隐藏凭据]'
const label = String.raw`(?:api[ _-]?key|access[ _-]?token|refresh[ _-]?token|client[ _-]?secret|private[ _-]?key|sudo[ _-]?password|password|passphrase|密码|密钥|令牌|token)`
const assignment = String.raw`\s*["']?\s*(?:[:=：]|(?:\bis\b|\bare\b|是|为)\s*)\s*`
const reference = /^(?:\[.*(?:隐藏|删除|redact).*\]|由.+保管|老师保管|用户保管|未设置|未配置|已删除|不保存|不记录|<[^>]+>|\*{3,})$/i
const secretKeys = /^(?:password|passphrase|sudopassword|apikey|accesstoken|refreshtoken|clientsecret|privatekey|token|authorization|secret|密码|密钥|令牌)$/i

/** Host-only values used for redaction. Never serialize this list into events or model results. */
export function credentialValues(text: string): string[] {
  const values = new Set<string>()
  const pattern = label + assignment + String.raw`(?:(["'\x60])([^\r\n]{1,16000}?)\1|([^\s"'\x60，。；;、,]+))`
  for (const match of text.matchAll(new RegExp(pattern, 'giu'))) {
    const value = match[2] ?? match[3]!
    if (!reference.test(value)) values.add(value)
  }
  for (const match of text.matchAll(/\bsk-[A-Za-z0-9_-]{16,}/g)) values.add(match[0])
  return [...values]
}

export function redactCredentialText(text: string, known: readonly string[] = []): string {
  return redactCredentialJson(text, known) as string
}

function redactProse(text: string, known: readonly string[]): string {
  const values = [...new Set([...credentialValues(text), ...known])].filter(Boolean).sort((a, b) => b.length - a.length)
  for (const value of values) text = text.replaceAll(value, credentialHidden)
  return text
}

/** Preserve protocol and business IDs; only credential fields and text contents are masked. */
export function redactCredentialJson(value: JsonValue, known: readonly string[] = [], detectLabels = true,
  mapText: JsonTextProjector = mapJsonText): JsonValue {
  const visit = (item: JsonValue): JsonValue => redactCredentialJson(item, known, detectLabels, mapText)
  if (typeof value === 'string') {
    return mapText(value, visit, text => detectLabels ? redactProse(text, known) : replaceKnown(text, known))
  }
  if (Array.isArray(value)) return value.map(visit)
  if (typeof value === 'number' || typeof value === 'boolean') return known.some(secret => secret.length >= 3 && secret === String(value)) ? credentialHidden : value
  if (!value || typeof value !== 'object') return value
  if (isSignedThinking(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (isRuntimeProtocolField(key, value) || isMediaPayloadField(key, value)) return [key, item]
    if (detectLabels && secretKeys.test(key.replace(/[ _-]/g, '')) && typeof item !== 'object' && !reference.test(String(item))) return [key, credentialHidden]
    if (/^(?:id|.*Id|.*ID|name|type|role|format|runtimeVersion|revision|sha256|parentId)$/.test(key)) return [key, item]
    return [key, visit(item)]
  }))
}

function replaceKnown(text: string, known: readonly string[]): string {
  for (const value of [...known].filter(value => value.length >= 3).sort((a, b) => b.length - a.length)) text = text.replaceAll(value, credentialHidden)
  return text
}
