import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runIsolatedModule } from '@eden/execution'
import { jsonValue } from '@eden/api'
import { writeProgram } from './write-program.ts'

export async function writeWorkspaceFile(root: string, input: unknown, signal: AbortSignal) {
  const moduleRoot = await mkdtemp(path.join(tmpdir(), 'eden-workspace-write-'))
  try {
    await writeFile(path.join(moduleRoot, 'index.mjs'), writeProgram, { mode: 0o600 })
    const result = await runIsolatedModule({ moduleRoot, readRoot: root, writableWorkspace: true, input, signal })
    if (result.exitCode !== 0) throw new Error(result.stderr.slice(0, 2000) || 'Workspace write failed')
    return jsonValue.parse(JSON.parse(result.stdout).result)
  } finally { await rm(moduleRoot, { recursive: true, force: true }) }
}
