import { z } from 'zod'

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export const jsonValue: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.array(jsonValue), z.record(z.string(), jsonValue),
]))

export function toJson(value: unknown): JsonValue {
  return jsonValue.parse(JSON.parse(JSON.stringify(value)))
}
