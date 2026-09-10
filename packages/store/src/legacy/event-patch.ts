function patchObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Decoder for the archived Rust externally-tagged Patch enum; never evaluates stored code. */
export function applyLegacyEventPatch(base: unknown, raw: unknown, depth = 0): unknown {
  if (depth > 128 || !patchObject(raw)) throw new Error('Invalid legacy event patch')
  const entries = Object.entries(raw)
  if (entries.length !== 1) throw new Error('Legacy event patch must have one tag')
  const [tag, value] = entries[0]!
  if (tag === 'Replace') return value
  if (tag === 'Append' && typeof base === 'string' && typeof value === 'string') return base + value
  if (!Array.isArray(value) || value.length !== 2) throw new Error('Invalid legacy event patch arguments')
  const [changes, extra] = value
  if (!patchObject(changes)) throw new Error('Invalid legacy event patch changes')
  if (tag === 'Object') return applyObjectPatch(base, changes, extra, depth)
  if (tag === 'Array') return applyArrayPatch(base, changes, extra, depth)
  throw new Error('Legacy patch does not match its base value')
}

function applyObjectPatch(base: unknown, changes: Record<string, unknown>, extra: unknown, depth: number) {
  if (!patchObject(base) || !Array.isArray(extra) || !extra.every(key => typeof key === 'string')) throw new Error('Legacy patch does not match its base value')
  const result: Record<string, unknown> = Object.assign(Object.create(null), base)
  for (const key of extra) delete result[key]
  for (const [key, patch] of Object.entries(changes)) result[key] = applyLegacyEventPatch(Object.hasOwn(result, key) ? result[key] : null, patch, depth + 1)
  return result
}

function applyArrayPatch(base: unknown, changes: Record<string, unknown>, extra: unknown, depth: number) {
  if (!Array.isArray(base) || typeof extra !== 'number' || !Number.isSafeInteger(extra) || extra < 0 || extra > 1000000) throw new Error('Legacy patch does not match its base value')
  const result = Array.from({ length: extra }, (_, index) => index < base.length ? base[index] : null)
  for (const [index, patch] of Object.entries(changes)) {
    if (!/^(0|[1-9]\d*)$/.test(index) || !Number.isSafeInteger(Number(index)) || Number(index) >= extra) throw new Error('Invalid legacy array patch index')
    result[Number(index)] = applyLegacyEventPatch(result[Number(index)], patch, depth + 1)
  }
  return result
}
