import { attachmentSnapshotsSchema } from '@eden/api'
import type { AttachmentSnapshot } from '@eden/api'
import type { EdenDatabase } from '@eden/store'

export class AttachmentRepository {
  constructor(private readonly database: EdenDatabase) {}

  current(sessionId: string, turnId: string): AttachmentSnapshot[] {
    const row = this.database.connection.prepare(`SELECT inputs.metadata_json FROM inputs
      JOIN sessions ON sessions.id = inputs.session_id
      WHERE inputs.session_id = ? AND inputs.turn_id = ? AND inputs.state = 'running' AND sessions.status = 'active'`)
      .get(sessionId, turnId)
    if (!row) throw new Error('Attachment access requires the active input in this session')
    const metadata: unknown = JSON.parse(String(row.metadata_json))
    const value = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {}
    return attachmentSnapshotsSchema.parse(value.attachments ?? [])
  }
}
