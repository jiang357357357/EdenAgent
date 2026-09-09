import type { MemoInfo } from '@eden/api'
import type { JobRepository } from '../jobs/index.ts'
import { nextMemoOccurrence } from './repeat.ts'

export function scheduleMemo(jobs: JobRepository, memo: MemoInfo): void {
  const at = memo.snoozedUntil ?? memo.remindAt ?? memo.dueAt
  if (memo.repeatRule) nextMemoOccurrence(memo.repeatRule, at ?? Date.now(), Date.now())
  if (memo.status !== 'active' || at === null || (memo.lastTriggeredAt !== null && memo.lastTriggeredAt >= at)) return
  jobs.scheduleInTransaction({ kind: 'memo.reminder', sessionId: memo.relatedSessionId || null, dueAt: at,
    payload: { memoId: memo.id, revision: memo.updatedAt, occurrence: at }, key: `memo:${memo.id}:${memo.updatedAt}`,
    causationId: `memo:${memo.id}`, depth: 0 })
}
