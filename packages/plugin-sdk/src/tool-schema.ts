import { isDeepStrictEqual } from 'node:util'
import type { JsonValue } from '@eden/api'

type Schema = Record<string, JsonValue>
const supported = new Set(['type', 'description', 'properties', 'required', 'additionalProperties', 'items', 'enum'])
const types = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])

function object(value: JsonValue): value is Schema {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Deliberately bounded JSON Schema subset. No remote refs or executable regexes. */
export function validateToolSchema(value: JsonValue, depth = 0): asserts value is Schema {
  if (depth > 12 || !object(value)) throw new Error('Tool schema must be an object with depth <= 12')
  if (Object.keys(value).some(key => !supported.has(key))) throw new Error('Unsupported tool schema keyword')
  if (typeof value.type !== 'string' || !types.has(value.type)) throw new Error('Unsupported tool schema type')
  if (value.description !== undefined && typeof value.description !== 'string') throw new Error('Invalid schema description')
  if (value.enum !== undefined && (!Array.isArray(value.enum) || !value.enum.length)) throw new Error('Invalid schema enum')
  validateContainer(value, depth)
}

function validateContainer(value: Schema, depth: number): void {
  if (value.type === 'object') validateObject(value, depth)
  else if (value.properties !== undefined || value.required !== undefined || value.additionalProperties !== undefined) throw new Error('Object keywords on non-object schema')
  if (value.type === 'array') {
    if (value.items === undefined) throw new Error('Array schema requires items')
    validateToolSchema(value.items, depth + 1)
  } else if (value.items !== undefined) throw new Error('Items keyword on non-array schema')
}

function validateObject(schema: Schema, depth: number): void {
  if (!schema.properties || !object(schema.properties)) throw new Error('Object schema requires properties')
  const properties = schema.properties
  if (schema.additionalProperties !== false) throw new Error('Object schema must reject additional properties')
  if (schema.required !== undefined && (!Array.isArray(schema.required) ||
    schema.required.some(key => typeof key !== 'string' || !Object.hasOwn(properties, key)))) throw new Error('Invalid required properties')
  for (const item of Object.values(properties)) validateToolSchema(item, depth + 1)
}

export function assertToolInput(schema: Schema, input: JsonValue, location = '$'): void {
  validateToolSchema(schema)
  checkInput(schema, input, location)
}

function checkInput(schema: Schema, input: JsonValue, location: string): void {
  if (Array.isArray(schema.enum) && !schema.enum.some(value => isDeepStrictEqual(value, input))) throw new Error(`Input ${location} is outside enum`)
  if (!hasType(schema.type, input)) throw new Error(`Input ${location} must have type ${String(schema.type)}`)
  if (schema.type === 'object' && object(input)) {
    const properties = schema.properties as Schema
    for (const key of schema.required as string[] ?? []) if (!Object.hasOwn(input, key)) throw new Error(`Input ${location}.${key} is required`)
    for (const [key, value] of Object.entries(input)) {
      if (!Object.hasOwn(properties, key)) throw new Error(`Input ${location}.${key} is not declared`)
      checkInput(properties[key] as Schema, value, `${location}.${key}`)
    }
  }
  if (schema.type === 'array' && Array.isArray(input)) input.forEach((item, index) => checkInput(schema.items as Schema, item, `${location}[${index}]`))
}

function hasType(type: JsonValue | undefined, input: JsonValue): boolean {
  if (type === 'null') return input === null
  if (type === 'array') return Array.isArray(input)
  if (type === 'object') return object(input)
  if (type === 'integer') return typeof input === 'number' && Number.isInteger(input)
  return typeof input === type
}
