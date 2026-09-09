import { attachmentSnapshotsSchema } from '@eden/api'
import type { JsonValue } from '@eden/api'

export function inputAttachments(metadata?: JsonValue) {
  const value = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}
  return attachmentSnapshotsSchema.parse(value.attachments ?? [])
}
