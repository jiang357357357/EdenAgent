export interface BridgeRecord { kind: string; fields: Record<string, string> }
export function parseBridgeRecord(line: string, marker: string): BridgeRecord | undefined {
  const start = line.indexOf(marker)
  if (start < 0) return undefined
  const [version, kind, ...parts] = line.slice(start + marker.length).split('|')
  if (version !== '1' || !kind) return undefined
  const fields = Object.fromEntries(parts.flatMap(part => {
    const equal = part.indexOf('=')
    return equal > 0 ? [[part.slice(0, equal), part.slice(equal + 1)]] : []
  }))
  return { kind, fields }
}
