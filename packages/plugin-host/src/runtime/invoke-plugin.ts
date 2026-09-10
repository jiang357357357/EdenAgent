import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { jsonValue } from '@eden/api'
import type { JsonValue } from '@eden/api'
import { runHostModule } from '@eden/execution'
import { assertToolInput } from '@eden/plugin-sdk'
import type { InstalledPlugin } from '../installation/version-repository.ts'

export async function invokePlugin(plugin: InstalledPlugin, input: JsonValue, readRoot?: string, signal?: AbortSignal): Promise<JsonValue> {
  assertToolInput(plugin.manifest.tool.parameters, input)
  const root = await mkdtemp(path.join(tmpdir(), 'eden-plugin-run-'))
  try {
    await writeFile(path.join(root, 'index.mjs'), plugin.artifact, { mode: 0o600 })
    const result = await runHostModule({ moduleRoot: root, input, ...(readRoot ? { readRoot } : {}), ...(signal ? { signal } : {}) })
    if (result.exitCode !== 0) throw new Error(result.stderr.slice(0, 2000) || 'Plugin execution failed')
    return jsonValue.parse(JSON.parse(result.stdout).result)
  } finally { await rm(root, { recursive: true, force: true }) }
}
