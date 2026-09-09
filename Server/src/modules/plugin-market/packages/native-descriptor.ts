import path from 'node:path'
import { connectorManifestSchema } from '@eden/api'
export function nativeWorkerDescriptor(files: Map<string, Buffer>, manifestPath: string) {
  const bytes = files.get(manifestPath)
  if (!bytes || bytes.length > 262144) throw new Error('Native worker connector manifest is missing or too large')
  const manifest = connectorManifestSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  const directory = path.posix.dirname(manifestPath)
  const entrypoints = Object.fromEntries(Object.entries(manifest.entrypoints).map(([platform, entry]) => {
    if (!entry.path || /[\\:\x00-\x1f]/.test(entry.path) || entry.path.startsWith('/') || entry.path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Native worker entrypoint must stay within its component directory')
    if (entry.args.some(arg => arg.includes('\0'))) throw new Error('Native worker argument contains a null byte')
    return [platform, { path: path.posix.join(directory, entry.path), args: entry.args }]
  }))
  return { manifest, entrypoints }
}
