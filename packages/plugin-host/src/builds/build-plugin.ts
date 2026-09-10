import { createHash } from 'node:crypto'
import { transform } from 'esbuild'
import type { PluginDraft } from '../drafts/draft-repository.ts'
import { typecheckPlugin } from './typecheck-plugin.ts'

export interface BuiltPlugin extends PluginDraft { artifact: string; revision: string }

export function pluginRevision(plugin: PluginDraft & { artifact: string }): string {
  return createHash('sha256').update(JSON.stringify({
    manifest: plugin.manifest, source: plugin.source, artifact: plugin.artifact, compiler: 'typescript-5.9.3+esbuild-0.28.1', format: 1,
  })).digest('hex')
}

export async function buildPlugin(draft: PluginDraft, signal?: AbortSignal): Promise<BuiltPlugin> {
  await typecheckPlugin(draft.source, signal)
  signal?.throwIfAborted()
  // Transform parses TypeScript without loading configuration, resolving packages,
  // or executing the plugin. All module execution happens in a separate host process.
  const result = await transform(draft.source, { loader: 'ts', format: 'esm', target: 'node22', sourcemap: false, sourcefile: 'index.ts' })
  const revision = pluginRevision({ ...draft, artifact: result.code })
  return { ...draft, artifact: result.code, revision }
}
