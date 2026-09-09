import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { probeSandbox, runIsolatedModule } from '@eden/execution'
import { jsonValue } from '@eden/api'
import { z } from 'zod'
import type { BuiltPlugin } from '../builds/build-plugin.ts'

export const testReportSchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{64}$/), passed: z.boolean(), testedAt: z.number().int(), backend: z.string(),
  cases: z.array(z.object({ index: z.number().int(), passed: z.boolean(), error: z.string().nullable() }).strict()),
}).strict()
export type PluginTestReport = z.infer<typeof testReportSchema>

export async function testPlugin(plugin: BuiltPlugin, signal?: AbortSignal): Promise<PluginTestReport> {
  const sandbox = await probeSandbox()
  if (!sandbox.available) throw new Error(`Plugin tests require an OS sandbox: ${sandbox.detail}`)
  const root = await mkdtemp(path.join(tmpdir(), 'eden-plugin-test-'))
  try {
    await writeFile(path.join(root, 'index.mjs'), plugin.artifact)
    const cases: PluginTestReport['cases'] = []
    for (const [index, test] of plugin.manifest.tests.entries()) {
      signal?.throwIfAborted()
      try {
        const result = await runIsolatedModule({ moduleRoot: root, input: test.input, ...(signal ? { signal } : {}) })
        if (result.exitCode !== 0) throw new Error(result.stderr.slice(0, 2000) || 'Plugin process failed')
        const actual = jsonValue.parse(JSON.parse(result.stdout).result)
        const passed = isDeepStrictEqual(actual, test.expected)
        cases.push({ index, passed, error: passed ? null : 'Result differs from expected value' })
      } catch (error) { cases.push({ index, passed: false, error: error instanceof Error ? error.message : 'Plugin test failed' }) }
    }
    signal?.throwIfAborted()
    return { revision: plugin.revision, passed: cases.every(item => item.passed), testedAt: Date.now(), backend: sandbox.backend, cases }
  } finally { await rm(root, { recursive: true, force: true }) }
}
