interface Asset { source: string; targetKind: string; target: string }
/** Expand declared directories without granting access to unrelated package files. */
export function packageAssetFiles(assets: Asset[], files: Map<string, Buffer>): Asset[] {
  const entries: Asset[] = [], sources = new Set<string>(), targets = new Set<string>()
  for (const asset of assets) {
    const names = files.has(asset.source) ? [asset.source] : [...files.keys()].filter(name => name.startsWith(asset.source + '/')).sort()
    if (!names.length) throw new Error('Declared plugin asset file or directory is missing')
    for (const source of names) {
      const target = source === asset.source ? asset.target : asset.target + source.slice(asset.source.length)
      const destination = JSON.stringify([asset.targetKind, target])
      if (sources.has(source) || targets.has(destination)) throw new Error('Plugin assets contain overlapping sources or target paths')
      sources.add(source); targets.add(destination)
      entries.push({ source, targetKind: asset.targetKind, target })
    }
  }
  return entries
}
