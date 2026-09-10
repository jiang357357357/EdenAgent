import { serverVersion } from '../../../version.ts'
interface Version { core: bigint[]; prerelease: string[] }
function parse(value: string): Version {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value)
  if (!match || value.length > 128) throw new Error('Plugin host version bounds must be semantic versions')
  const prerelease = match[4]?.split('.') ?? []
  if (prerelease.some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) throw new Error('Numeric prerelease identifiers cannot have leading zeros')
  return { core: [BigInt(match[1]!), BigInt(match[2]!), BigInt(match[3]!)], prerelease }
}
function compare(left: Version, right: Version): number {
  for (let index = 0;index < 3;index++) {
    if (left.core[index] !== right.core[index]) return left.core[index]! < right.core[index]! ? -1 : 1
  }
  return comparePrerelease(left, right)
}
export function assertPackageHostVersion(minimum?: string, maximum?: string): void {
  const host = parse(serverVersion), min = minimum === undefined ? null : parse(minimum), max = maximum === undefined ? null : parse(maximum)
  if (min && max && compare(min, max) > 0) throw new Error('Plugin minimum host version exceeds its maximum')
  if ((min && compare(host, min) < 0) || (max && compare(host, max) > 0)) throw new Error(`Plugin package is not compatible with host ${serverVersion}`)
}

function comparePrerelease(left: Version, right: Version): number {
  if (!left.prerelease.length || !right.prerelease.length) return left.prerelease.length ? -1 : right.prerelease.length ? 1 : 0
  for (let index = 0;index < Math.max(left.prerelease.length, right.prerelease.length);index++) {
    const a = left.prerelease[index], b = right.prerelease[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    if (a === b) continue
    const numericA = /^\d+$/.test(a), numericB = /^\d+$/.test(b)
    if (numericA && numericB) return BigInt(a) < BigInt(b) ? -1 : 1
    if (numericA !== numericB) return numericA ? -1 : 1
    return a < b ? -1 : 1
  }
  return 0
}
