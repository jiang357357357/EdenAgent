import { rpcMethods } from '@eden/api'
import { contractHandler } from './contract-handler.ts'
import type { JsonValue } from '@eden/api'
import type { MediaService } from '../../modules/media/index.ts'
export function mediaRoutes(media: MediaService): Record<string, (raw: JsonValue) => JsonValue | Promise<JsonValue>> {
  return { 'media.list': contractHandler(rpcMethods['media.list'], input => media.list(input.kind)),
    'media.resolve': contractHandler(rpcMethods['media.resolve'], input => media.resolve(input)) }
}
