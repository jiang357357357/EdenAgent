import { z } from 'zod'
import type { VerifiedPackage } from './verified-package.ts'
type Package = VerifiedPackage
const relative = z.string().min(1).max(1024).refine(value => !value.startsWith('/') && !/[\\:\x00-\x1f]/.test(value)
  && value.split('/').every(part => part && part !== '..' && part !== '.'), 'Expected a confined package path')
const stdio = z.object({
  schemaVersion: z.literal(1).default(1), command: z.string().min(1).max(4096).refine(value => !/[\r\n\0]/.test(value)),
  args: z.array(z.string().max(8192).refine(value => !value.includes('\0'))).max(128).default([]),
  cwd: z.union([z.literal('.'), relative]).default('.')
}).strict()
const http = z.object({ schemaVersion: z.literal(1).default(1), url: z.string().min(1).max(8192) }).strict()
export function packageRuntimeDescriptors(value: Package, enabled: (id: string, fallback: boolean) => boolean) {
  return value.manifest.components.runtimes.filter(item => item.kind !== 'native_worker' && enabled(item.id, item.enabledByDefault)).map(component => {
    const bytes = value.files.get(component.manifest)
    if (!bytes || bytes.length > 65536) throw new Error('Runtime descriptor is missing or too large')
    const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    const owner = { pluginId: value.manifest.id, revision: value.revision, componentId: component.id }
    if (component.kind === 'mcp_stdio') {
      const descriptor = stdio.parse(raw)
      return {
        ...owner, kind: 'mcp_stdio' as const, descriptor,
        permission: { capability: 'process.execute', resource: descriptor.command, access: 'execute' }
      }
    }
    if (component.kind === 'mcp_http') {
      const descriptor = http.parse(raw), url = new URL(descriptor.url)
      if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) {
        throw new Error('MCP HTTP descriptor requires HTTPS or loopback HTTP without embedded credentials or fragment')
      }
      return {
        ...owner, kind: 'mcp_http' as const, descriptor,
        permission: { capability: 'network.connect', resource: descriptor.url, access: 'connect' }
      }
    }
    throw new Error('Package native worker components require the official connector lifecycle')
  })
}
