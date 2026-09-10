import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { probeHostExecution, runHostModule } from '@eden/execution'
import { jsonValue } from '@eden/api'
import type { BuiltPlugin } from '../builds/build-plugin.ts'

export { pluginTestReportSchema as testReportSchema } from '@eden/api'
import { pluginTestReportSchema as testReportSchema, type PluginTestReport } from '@eden/api'
export type { PluginTestReport } from '@eden/api'

export async function testPlugin(plugin: BuiltPlugin, signal?: AbortSignal): Promise<PluginTestReport> {
  const execution = await probeHostExecution()
  if (!execution.available) throw new Error(`Plugin execution is unavailable: ${execution.detail}`)
  const root = await mkdtemp(path.join(tmpdir(), 'eden-plugin-test-'))
  try {
    await writeFile(path.join(root, 'index.mjs'), plugin.artifact)
    const cases: PluginTestReport['cases'] = []
    for (const [index, test] of plugin.manifest.tests.entries()) {
      signal?.throwIfAborted()
      try {
        const result = await runHostModule({ moduleRoot: root, input: test.input, ...(signal ? { signal } : {}) })
        if (result.exitCode !== 0) throw new Error(result.stderr.slice(0, 2000) || 'Plugin process failed')
        const actual = jsonValue.parse(JSON.parse(result.stdout).result)
        const passed = isDeepStrictEqual(actual, test.expected)
        cases.push({ index, passed, error: passed ? null : 'Result differs from expected value' })
      } catch (error) { cases.push({ index, passed: false, error: error instanceof Error ? error.message : 'Plugin test failed' }) }
    }
    signal?.throwIfAborted()
    return { revision: plugin.revision, passed: cases.every(item => item.passed), testedAt: Date.now(), backend: execution.backend, cases }
  } finally { await rm(root, { recursive: true, force: true }) }
}
