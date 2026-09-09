import type { LegacyRow, LegacyCell } from './snapshot-format.ts'
export function legacyText(row: LegacyRow, key: string): string {
  if (typeof row[key] !== 'string') throw new Error(`Expected legacy text field: ${key}`)
  return row[key] as string
}
export function legacyUuid(row: LegacyRow, key: string): string {
  const value = legacyText(row, key)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error(`Invalid legacy UUID: ${key}`)
  return value
}
export function legacyTime(value: LegacyCell | undefined): number {
  if ((typeof value !== 'bigint' && typeof value !== 'number') || !Number.isSafeInteger(Number(value))) throw new Error('Invalid legacy timestamp')
  return Number(value)
}
export function legacyJson(row: LegacyRow, key: string): string {
  const value = legacyText(row, key)
  JSON.parse(value)
  return value
}
export function preserveLegacyRow(row: LegacyRow): string {
  return JSON.stringify(Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
    typeof value === 'bigint' ? { type: 'integer', value: String(value) } : Buffer.isBuffer(value) ? { type: 'blob', value: value.toString('base64') } :
      { type: value === null ? 'null' : typeof value === 'number' ? 'real' : 'text', value }])))
}
