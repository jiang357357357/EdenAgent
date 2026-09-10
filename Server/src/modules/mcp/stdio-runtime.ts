import { McpClient, McpStdioChannel } from '@eden/integrations'
import { launchMcpProcess, type ExternalCommandSandbox } from '@eden/execution'
import type { InstalledPackageRepository } from '../plugin-market/index.ts'
type Plan = ReturnType<InstalledPackageRepository['runtimePlan']>
type Component = Plan['runtimes'][number]

export async function connectMcpStdio(component: Component, files: Plan['files'], authorize: () => void, signal: AbortSignal, external?: ExternalCommandSandbox) {
  if (component.kind !== 'mcp_stdio') throw new Error('Expected MCP stdio component')
  authorize(); signal.throwIfAborted()
  const process = await launchMcpProcess(files, component.descriptor, signal, external)
  let catalogChanged = false
  const channel = new McpStdioChannel(process.input, process.output, process.terminate, method => {
    if (['notifications/tools/list_changed', 'notifications/resources/list_changed'].includes(method)) catalogChanged = true
  })
  const client = new McpClient(channel)
  try {
    const server = await client.initialize(signal)
    authorize(); signal.throwIfAborted()
    return { client, server, component, exited: process.exited,
      takeCatalogChange() { const changed = catalogChanged; catalogChanged = false; return changed },
      async close() { client.close(); await process.close() } }
  } catch (error) { client.close(); await process.close(); throw error }
}
