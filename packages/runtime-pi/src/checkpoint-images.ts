import type { JsonValue, RuntimeCheckpoint } from '@eden/api'
import { runtimeImages } from './images.ts'
import type { RuntimeImage } from './contracts.ts'
import { RuntimePersistenceError } from './persistence-error.ts'

export function validCheckpointImage(value: JsonValue): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.type !== 'image') return false
  try { runtimeImages([value as unknown as RuntimeImage]); return true } catch { return false }
}

/** Validate SDK message images, not arbitrary tool-owned JSON fields that happen to be called data. */
export function assertCheckpointImages(checkpoint: RuntimeCheckpoint): void {
  const content = (value: JsonValue | undefined) => {
    if (!Array.isArray(value)) return
    for (const block of value) if (block && typeof block === 'object' && !Array.isArray(block)
      && block.type === 'image' && !validCheckpointImage(block))
      throw new RuntimePersistenceError('历史图片数据损坏，未发送给模型；请从原始附件恢复或重新提供图片', new Error('Invalid checkpoint image encoding'))
  }
  const visit = (value: JsonValue): void => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!value || typeof value !== 'object') return
    if (typeof value.role === 'string' || value.type === 'custom_message') content(value.content)
    if (value.message) visit(value.message)
    if (value.retainedTail) visit(value.retainedTail)
  }
  checkpoint.entries.forEach(visit)
}
