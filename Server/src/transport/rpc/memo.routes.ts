import { rpcMethods, type JsonValue } from '@eden/api'
import type { MemoRepository, MemoNotifications } from '../../modules/memos/index.ts'
import { contractHandler } from './contract-handler.ts'
export function memoRoutes(memos: MemoRepository, notifications: MemoNotifications): Record<string, (params: JsonValue) => Promise<JsonValue>> {
  return {
    'memo.notification.list': contractHandler(rpcMethods['memo.notification.list'], input => notifications.list(input.limit)),
    'memo.notification.acknowledge': contractHandler(rpcMethods['memo.notification.acknowledge'], input => notifications.acknowledge(input.id)),
    'memo.list': contractHandler(rpcMethods['memo.list'], input => memos.list(input.limit, input.query)),
    'memo.create': contractHandler(rpcMethods['memo.create'], input => memos.create(input)),
    'memo.update': contractHandler(rpcMethods['memo.update'], input => memos.update(input.id, input.patch)),
    'memo.complete': contractHandler(rpcMethods['memo.complete'], input => memos.update(input.id, { status: 'done' })),
    'memo.archive': contractHandler(rpcMethods['memo.archive'], input => memos.update(input.id, { status: 'archived' })),
  }
}
