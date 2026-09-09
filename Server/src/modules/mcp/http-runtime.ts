import { McpClient, McpHttpChannel } from '@eden/integrations'
import type { InstalledPackageRepository } from '../plugin-market/index.ts'
type Component = ReturnType<InstalledPackageRepository['runtimePlan']>['runtimes'][number]

export async function connectMcpHttp(component: Component, authorize: () => void, signal: AbortSignal) {
  if (component.kind !== 'mcp_http') throw new Error('Expected MCP HTTP component')
  authorize(); signal.throwIfAborted()
  let catalogChanged = false
  const channel = new McpHttpChannel(component.descriptor.url, authorize, method => {
    if (['notifications/tools/list_changed', 'notifications/resources/list_changed'].includes(method)) catalogChanged = true
  })
  const client = new McpClient(channel), stop = () => client.close()
  const exited = new Promise<void>(resolve => channel.closedSignal.addEventListener('abort', () => {
    signal.removeEventListener('abort', stop); resolve()
  }, { once: true }))
  signal.addEventListener('abort', stop, { once: true })
  if (signal.aborted) stop()
  try {
    const server = await client.initialize(signal)
    authorize(); signal.throwIfAborted()
    channel.startNotifications()
    return { client, server, component, exited: exited.then(() => channel.dispose()),
      takeCatalogChange() { const changed = catalogChanged; catalogChanged = false; return changed },
      async close() { await channel.dispose(); client.close(); await exited } }
  } catch (error) { await channel.dispose(); client.close(); await exited; throw error }
}
