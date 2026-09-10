import { z } from 'zod'
import type { JsonValue } from '@eden/api'
/** Interpret only the schema vocabulary used by trusted official connector manifests. */
export function capabilityInput(raw: JsonValue, depth = 0): z.ZodType {
  validateCapabilitySchema(depth, raw)
  let schema: z.ZodType
  if (raw.type === 'object') {
    schema = objectCapability(raw, depth)
  } else if (raw.type === 'array') {
    schema = z.array(capabilityInput(raw.items!, depth + 1)).min(Number(raw.minItems ?? 0)).max(Number(raw.maxItems ?? 10000))
  } else if (raw.type === 'string') {
    schema = stringCapability(raw)
  } else if (raw.type === 'integer' || raw.type === 'number') {
    schema = numberCapability(raw)
  } else if (raw.type === 'boolean') schema = z.boolean()
  else if (raw.type === 'null') schema = z.null()
  else throw new Error('Unsupported connector input type')
  if (Array.isArray(raw.enum)) { const values = raw.enum.map(item => JSON.stringify(item)); schema = schema.refine(value => values.includes(JSON.stringify(value)), 'Value is outside connector enum') }
  return schema
}

function validateCapabilitySchema(depth: number, raw: JsonValue): asserts raw is Record<string, JsonValue> {
  if (depth > 12 || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid connector capability schema')
  const allowed = ['type', 'title', 'description', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'pattern', 'format']
  if (Object.keys(raw).some(key => !allowed.includes(key))) throw new Error('Unsupported connector schema keyword')
}

function numberCapability(raw: { [key: string]: JsonValue }) {
  let number = z.number().min(Number(raw.minimum ?? -Number.MAX_VALUE)).max(Number(raw.maximum ?? Number.MAX_VALUE))
  if (raw.type === 'integer') number = number.int().safe()
  return number
}

function stringCapability(raw: { [key: string]: JsonValue }) {
  let text = z.string().min(Number(raw.minLength ?? 0)).max(Number(raw.maxLength ?? 65536))
  if (typeof raw.pattern === 'string') text = text.regex(new RegExp(raw.pattern))
  if (raw.format === 'uuid') text = text.uuid()
  return text
}

function objectCapability(raw: { [key: string]: JsonValue }, depth: number) {
  const properties = z.record(z.string(), z.unknown()).parse(raw.properties ?? {})
  const required = z.array(z.string()).parse(raw.required ?? [])
  if (required.some(key => !Object.hasOwn(properties, key))) throw new Error('Undeclared required connector field')
  const shape: Record<string, z.ZodType> = {}
  for (const [key, value] of Object.entries(properties)) { const child = capabilityInput(value as JsonValue, depth + 1); shape[key] = required.includes(key) ? child : child.optional() }
  return raw.additionalProperties === true ? z.object(shape).passthrough() : z.object(shape).strict()
}
