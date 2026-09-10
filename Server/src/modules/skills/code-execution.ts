import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runSkillCommand, type ExternalCommandSandbox } from '@eden/execution'
import { assertToolInput } from '@eden/plugin-sdk'
import { toJson } from '@eden/api'
import type { SkillSnapshot } from './snapshot.ts'
import type { SkillCodeTool } from './code-manifest.ts'
export async function executeSkillCode(snapshot: SkillSnapshot, tool: SkillCodeTool, raw: unknown, signal: AbortSignal, external?: ExternalCommandSandbox) {
  const input = toJson(raw)
  assertToolInput(tool.parameters, input)
  const directory = await mkdtemp(path.join(os.tmpdir(), 'eden-skill-execution-'))
  try {
    for (const [filename, bytes] of Object.entries(snapshot.files)) {
      signal.throwIfAborted()
      if (path.isAbsolute(filename) || filename.includes('\\') || filename.split('/').includes('..')) throw new Error('Invalid installed skill file path')
      const target = path.join(directory, filename)
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
      await writeFile(target, Buffer.from(bytes, 'base64'), { flag: 'wx', mode: 0o700 })
    }
    const result = await runSkillCommand(directory, tool.command, input, tool.timeoutSeconds, signal, external)
    if (result.exitCode !== 0) throw new Error(`Skill command failed (${result.exitCode}): ${result.stderr.slice(0, 2000)}`)
    let output: unknown
    try { output = JSON.parse(result.stdout) } catch { output = result.stdout }
    if (tool.outputSchema) assertToolInput(tool.outputSchema, toJson(output))
    return toJson({ skill: snapshot.name, tool: tool.name, revision: snapshot.contentHash, output })
  } finally { await rm(directory, { recursive: true, force: true }) }
}
