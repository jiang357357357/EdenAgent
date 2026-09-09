import { memoryRecordSchema, memoryScopeSchema, memoryKindSchema } from '@eden/api'
import type { MemoryScope, MemoryRecord, MemoryKind, JsonValue } from '@eden/api'
import type { EdenDatabase } from '@eden/store'
import type { SQLOutputValue } from 'node:sqlite'
import { memoryContent } from './content.ts'

function record(row: Record<string, SQLOutputValue>): MemoryRecord {
  return memoryRecordSchema.parse({ id: row.id, content: row.content, kind: row.kind,
    scopeType: row.scope_type, scopeKey: row.scope_key, sourceSessionId: row.source_session_id,
    metadata: JSON.parse(String(row.metadata_json)), createdAt: row.created_at, updatedAt: row.updated_at })
}

export class MemoryRepository {
  constructor(private readonly database: EdenDatabase) {}

  create(scope: MemoryScope, content: string, kind: MemoryKind = 'fact', sourceSessionId = '', metadata: JsonValue = {}): MemoryRecord {
    const now = Date.now()
    const candidate = memoryRecordSchema.parse({ ...scope, id: 1, content: memoryContent(content), kind, sourceSessionId, metadata, createdAt: now, updatedAt: now })
    if (JSON.stringify(metadata).length > 16000) throw new Error('Memory metadata exceeds 16000 characters')
    return this.database.transaction(() => {
      const inserted = this.database.connection.prepare(`INSERT INTO memories(content, kind, scope_type, scope_key, source_session_id, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(candidate.content, candidate.kind, candidate.scopeType, candidate.scopeKey, candidate.sourceSessionId, JSON.stringify(metadata), now, now)
      return this.read(scope, Number(inserted.lastInsertRowid))
    })
  }

  read(scope: MemoryScope, id: number): MemoryRecord {
    const parsed = memoryScopeSchema.parse(scope)
    memoryRecordSchema.shape.id.parse(id)
    const row = this.database.connection.prepare('SELECT * FROM memories WHERE id=? AND scope_type=? AND scope_key=?').get(id, parsed.scopeType, parsed.scopeKey)
    if (!row) throw new Error('Memory not found in the current character scope')
    return record(row)
  }

  search(scope: MemoryScope, query = '', limit = 20): MemoryRecord[] {
    const parsed = memoryScopeSchema.parse(scope)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || query.length > 1000) throw new Error('Invalid memory search bounds')
    return this.database.connection.prepare(`SELECT * FROM memories WHERE scope_type=? AND scope_key=? AND instr(lower(content), lower(?)) > 0
      ORDER BY updated_at DESC, id DESC LIMIT ?`).all(parsed.scopeType, parsed.scopeKey, query.trim(), limit).map(record)
  }

  update(scope: MemoryScope, id: number, expectedUpdatedAt: number, content: string, kind?: MemoryKind): MemoryRecord {
    const safe = memoryContent(content)
    if (kind !== undefined) memoryKindSchema.parse(kind)
    return this.database.transaction(() => {
      const current = this.read(scope, id)
      if (current.updatedAt !== expectedUpdatedAt) throw new Error('Memory changed; review the current version')
      this.database.connection.prepare('UPDATE memories SET content=?, kind=?, updated_at=? WHERE id=?')
        .run(safe, kind ?? current.kind, Math.max(Date.now(), current.updatedAt + 1), id)
      return this.read(scope, id)
    })
  }

  forget(scope: MemoryScope, id: number, expectedUpdatedAt: number): void {
    this.database.transaction(() => {
      const current = this.read(scope, id)
      if (current.updatedAt !== expectedUpdatedAt) throw new Error('Memory changed; review the current version')
      this.database.connection.prepare('DELETE FROM memories WHERE id=?').run(id)
    })
  }
}
