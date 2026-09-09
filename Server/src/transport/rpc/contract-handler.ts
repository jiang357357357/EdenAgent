import { RpcFailure } from './errors.ts'
import { toJson, type JsonValue } from '@eden/api'
import type { z } from 'zod'

export function contractHandler<P extends z.ZodType, R extends z.ZodType>(contract: { params: P; result: R },
  handler: (input: z.output<P>) => unknown | Promise<unknown>): (raw: JsonValue) => Promise<JsonValue> {
  return async raw => {
    const input = contract.params.parse(raw)
    const result = contract.result.safeParse(await handler(input))
    if (!result.success) throw new RpcFailure(-32603, 'Server response did not satisfy the method contract')
    return toJson(result.data)
  }
}
