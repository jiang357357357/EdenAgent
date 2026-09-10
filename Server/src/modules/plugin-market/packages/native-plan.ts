import { createHash } from 'node:crypto'
import { nativeWorkerDescriptor } from './native-descriptor.ts'
import type { VerifiedPackage } from './verified-package.ts'
type Package = VerifiedPackage
/** The owning connector launcher consumes this immutable, version-bound plan. No process is started here. */
export function packageNativePlans(value: Package, enabled: (id: string, fallback: boolean) => boolean) {
  const platform = `${process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform}-${process.arch}`
  return value.manifest.components.runtimes.filter(component => component.kind === 'native_worker' && enabled(component.id, component.enabledByDefault)).map(component => {
    const descriptor = nativeWorkerDescriptor(value.files, component.manifest), entry = descriptor.entrypoints[platform]
    if (!entry) throw new Error('Native plugin component has no entrypoint for this platform')
    const bytes = value.files.get(entry.path)
    if (!bytes?.length || bytes.length > 64 * 1024 * 1024) throw new Error('Native plugin worker executable is missing or too large')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const owner = { pluginId: value.manifest.id, pluginRevision: value.revision, componentId: component.id }
    const key = `plugin-${createHash('sha256').update(JSON.stringify([owner.pluginId, owner.componentId])).digest('hex').slice(0, 40)}`
    return {
      ...owner, key, manifest: descriptor.manifest, platform, executablePath: entry.path, executable: Buffer.from(bytes), files: new Map([...value.files].map(([name, content]) => [name, Buffer.from(content)])), args: [...entry.args], sha256,
      revision: createHash('sha256').update(JSON.stringify({ ...owner, platform, sha256, args: entry.args, manifest: descriptor.manifest })).digest('hex')
    }
  })
}
