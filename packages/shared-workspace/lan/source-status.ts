import type { SourceStatus } from './source-contracts.ts'
import { integer, record, text } from './validation.ts'
import { LanError } from './contracts.ts'

export function sourceStatus(value: unknown): SourceStatus {
  const data = record(value)
  if (data.state !== 'idle' && data.state !== 'syncing' && data.state !== 'offline' && data.state !== 'conflict') throw new LanError(400, '无效云端源目录状态')
  if (data.error !== null && typeof data.error !== 'string') throw new LanError(400, '无效云端源目录诊断')
  return { path: text(data.path, 4096), state: data.state, pending: integer(data.pending), conflicts: integer(data.conflicts),
    error: typeof data.error === 'string' ? data.error.slice(0, 2048) : null }
}
