export interface LegacyTable { name: string; file: string; schema: string; rows: number; bytes: number; sha256: string }
export interface LegacyManifest { format: 'eden.legacy-snapshot.v1'; origin: 'mon' | 'local'; createdAt: string; tables: LegacyTable[]; note: string }
export type LegacyCell = null | string | number | bigint | Buffer
export type LegacyRow = Record<string, LegacyCell>
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid legacy snapshot object')
  return value as Record<string, unknown>
}
export function legacyManifest(raw: unknown): LegacyManifest {
  const value = object(raw)
  if (value.format !== 'eden.legacy-snapshot.v1' || !['mon', 'local'].includes(String(value.origin)) || typeof value.createdAt !== 'string'
    || typeof value.note !== 'string' || !Array.isArray(value.tables) || value.tables.length > 10000) throw new Error('Invalid legacy manifest')
  const names = new Set<string>(), files = new Set<string>()
  const tables = value.tables.map(rawTable => {
    const table = object(rawTable)
    if (typeof table.name !== 'string' || !table.name || typeof table.schema !== 'string' || typeof table.file !== 'string'
      || !/^\d{3,5}\.ndjson$/.test(table.file) || typeof table.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(table.sha256)
      || !Number.isSafeInteger(table.rows) || Number(table.rows) < 0 || !Number.isSafeInteger(table.bytes) || Number(table.bytes) < 0
      || names.has(table.name) || files.has(table.file)) throw new Error('Invalid or duplicate legacy table entry')
    names.add(table.name); files.add(table.file)
    return table as unknown as LegacyTable
  })
  return { format: 'eden.legacy-snapshot.v1', origin: value.origin as 'mon' | 'local', createdAt: value.createdAt, note: value.note, tables }
}
export function legacyRow(raw: unknown): LegacyRow {
  return Object.fromEntries(Object.entries(object(raw)).map(([key, rawCell]) => {
    const cell = object(rawCell), value = cell.value
    if (cell.type === 'null' && value === null) return [key, null]
    if (cell.type === 'text' && typeof value === 'string') return [key, value]
    if (cell.type === 'real' && typeof value === 'number' && Number.isFinite(value)) return [key, value]
    if (cell.type === 'integer' && integerEncoding(value)) {
      const integer = BigInt(value)
      if (integer >= -9223372036854775808n && integer <= 9223372036854775807n) return [key, integer]
    }
    if (cell.type === 'blob' && typeof value === 'string') {
      const bytes = Buffer.from(value, 'base64')
      if (bytes.toString('base64') === value) return [key, bytes]
    }
    throw new Error(`Invalid legacy field encoding: ${key}`)
  }))
}

function integerEncoding(value: unknown): value is string { return typeof value === 'string' && /^-?(0|[1-9]\d*)$/.test(value) }
