import { RpcFailure } from './errors.ts'
import { toJson, type JsonValue } from '@eden/api'
import type { z } from 'zod'

export function contractHandler<C extends { params: z.ZodType; result: z.ZodType }>(contract: C,
  handler: (input: z.output<C['params']>) => unknown | Promise<unknown>): (raw: JsonValue) => Promise<JsonValue> {
  return async raw => {
    const input = contract.params.parse(raw) as z.output<C['params']>
    const result = contract.result.safeParse(await handler(input))
    if (!result.success) throw new RpcFailure(-32603, 'Server response did not satisfy the method contract')
    return toJson(result.data)
  }
}
