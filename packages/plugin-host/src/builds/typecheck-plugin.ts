import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { runProcess } from '@eden/execution'
import { typecheckProgram } from './typecheck-program.ts'

export async function typecheckPlugin(source: string, signal?: AbortSignal): Promise<void> {
  const require = createRequire(import.meta.url)
  const compilerUrl = pathToFileURL(require.resolve('typescript')).href
  const typeRoot = path.dirname(path.dirname(require.resolve('@types/node/package.json')))
  const result = await runProcess({ executable: process.execPath,
    args: ['--max-old-space-size=256', '--input-type=module', '-e', typecheckProgram],
    input: JSON.stringify({ source, compilerUrl, typeRoot }), timeoutMs: 15000, maxOutputBytes: 65536,
    ...(signal ? { signal } : {}) })
  if (result.exitCode !== 0) throw new Error(`Plugin typecheck failed: ${result.stderr.slice(0, 2000)}`)
  const parsed: unknown = JSON.parse(result.stdout)
  if (!parsed || typeof parsed !== 'object' || !('errors' in parsed) || !Array.isArray(parsed.errors)) throw new Error('Invalid plugin typecheck response')
  if (parsed.errors.length) throw new Error(`Plugin typecheck failed: ${parsed.errors.join('\n')}`)
}
