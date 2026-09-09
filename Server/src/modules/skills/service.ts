import { executeSkillCode } from './code-execution.ts'
import type { SkillSnapshot } from './snapshot.ts'
import type { SkillCodeTool } from './code-manifest.ts'
import { readGitSnapshot } from './git-source.ts'
import { skillInspectSchema, skillCreateSchema } from '@eden/api'
import { readLocalSnapshot, snapshot } from './snapshot.ts'
import { SkillRepository } from './repository.ts'
export class SkillService {
  private readonly abort = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  async close() { this.abort.abort(); await Promise.allSettled([...this.pending]) }
  constructor(readonly repository: SkillRepository) {}
  execute(data: SkillSnapshot, tool: SkillCodeTool, input: unknown, signal: AbortSignal) {
    this.abort.signal.throwIfAborted()
    if (this.pending.size >= 4) throw new Error('Skill operation concurrency limit reached')
    const task = executeSkillCode(data, tool, input, AbortSignal.any([signal, this.abort.signal]))
    this.pending.add(task)
    void task.finally(() => this.pending.delete(task)).catch(() => {})
    return task
  }
  inspect(raw: unknown) {
    this.abort.signal.throwIfAborted()
    if (this.pending.size >= 2) throw new Error('Two skill previews are already in progress')
    const task = this.inspectSource(raw)
    this.pending.add(task)
    void task.finally(() => this.pending.delete(task)).catch(() => {})
    return task
  }
  private async inspectSource(raw: unknown) {
    const input = skillInspectSchema.parse(raw)
    const root = this.repository.target(input.scope)
    const result = input.sourceType === 'git'
      ? await readGitSnapshot(input.sourceUri, input.sourceRef ?? '', input.sourceSubpath ?? '', this.abort.signal)
      : { data: await readLocalSnapshot(input.sourceUri, input.sourceSubpath ?? ''), commit: '' }
    this.abort.signal.throwIfAborted()
    const { data } = result
    return this.repository.preview(data, { type: input.sourceType, uri: input.sourceUri, ref: result.commit || input.sourceRef || '', subpath: input.sourceSubpath ?? '' }, input.scope, root)
  }
  create(raw: unknown) {
    const input = skillCreateSchema.parse(raw)
    const data = snapshot({ 'SKILL.md': Buffer.from(input.content).toString('base64') }, input.name)
    if (data.name !== input.name) throw new Error('Skill name differs from its frontmatter')
    data.description = input.description
    const preview = this.repository.preview(data, { type: 'generated', uri: '', ref: '', subpath: '' }, 'user')
    return this.repository.install(preview.previewID)
  }
}
