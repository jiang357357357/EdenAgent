import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { EdenDatabase } from '@eden/store'
import { SkillRepository, SkillService, skillTools } from '../src/modules/skills/index.ts'
import { readLocalSnapshot } from '../src/modules/skills/snapshot.ts'
import { captureRoleSkills } from '../src/modules/subagents/role-skills.ts'
import { PermissionService } from '../src/modules/permissions/index.ts'
import { SessionRepository } from '../src/modules/sessions/index.ts'

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-skill-tools-'))
  const db = new EdenDatabase(':memory:', 'local'), sessions = new SessionRepository(db, 'local')
  const session = sessions.create('Skill approvals'), permissions = new PermissionService(db, sessions.events)
  const repository: SkillRepository = new SkillRepository(db, undefined, undefined, () => ({ tools: ['echo_skill', 'run_skill_tool'], codeToolsAvailable: service.codeToolsAvailable }))
  const service: SkillService = new SkillService(repository)
  t.after(async () => { await service.close(); db.close(); await rm(root, { recursive: true, force: true }) })
  async function install(profiles: string[], body = 'Skill instruction') {
    await mkdir(path.join(root, 'tools'), { recursive: true })
    await writeFile(path.join(root, 'SKILL.md'), `---\nname: echo-skill\ndescription: Test echo skill\nmetadata:\n  edenagent:\n    profiles: ${JSON.stringify(profiles)}\n---\n${body}`)
    await writeFile(path.join(root, 'echo.mjs'), "let data=''; for await (const chunk of process.stdin) data+=chunk; console.log(JSON.stringify({echo:JSON.parse(data).text}))")
    await writeFile(path.join(root, 'tools/echo.json'), JSON.stringify({ schemaVersion: 1, name: 'echo_skill', description: 'Echo JSON',
      command: ['node', 'echo.mjs'], parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } }))
    const preview = repository.preview(await readLocalSnapshot(root, ''), { type: 'local', uri: root, ref: '', subpath: '' }, 'user')
    repository.install(preview.previewID)
  }
  await install(['user_chat', 'subagent']); await service.start()
  const tools = (profile = 'user_chat') => skillTools(service, permissions, session.id, session.id, profile)
  return { service, repository, permissions, install, tools, context: { callId: 'skill-call', signal: new AbortController().signal } }
}

test('legacy load_skill and subagent profiles read the same approved catalog without executing code', async t => {
  const f = await fixture(t)
  const tools = f.tools('subagent')
  const load = tools.find(tool => tool.name === 'load_skill')!, read = tools.find(tool => tool.name === 'read_skill')!
  assert.deepEqual(await load.execute({ name: 'echo-skill' }, f.context), await read.execute({ name: 'echo-skill' }, f.context))
  assert.equal(f.permissions.list().length, 0)
  assert.equal(captureRoleSkills(['echo-skill'], f.repository).length, 1)
  await f.install(['user_chat'])
  assert.throws(() => captureRoleSkills(['echo-skill'], f.repository), /subagent profile/)
  assert.equal(f.tools('subagent').some(tool => tool.name === 'echo_skill'), false)
  await assert.rejects(load.execute({ name: 'echo-skill' }, f.context), /profile/)
})

test('original skill code name waits for approval and executes JSON stdin in a real sandbox', async t => {
  const f = await fixture(t)
  if (!f.service.codeToolsAvailable) { t.skip('OS isolation unavailable; no host fallback'); return }
  const direct = f.tools().find(tool => tool.name === 'echo_skill')!
  const pending = direct.execute({ text: 'hello isolated skill' }, f.context)
  const request = f.permissions.list().find(item => item.state === 'pending')!
  assert.ok(request)
  f.permissions.resolve(request.id, true)
  const result = await pending
  assert.deepEqual((result as { output: unknown }).output, { echo: 'hello isolated skill' })
})

test('an approved direct call cannot execute a skill replaced while approval was pending', async t => {
  const f = await fixture(t)
  if (!f.service.codeToolsAvailable) { t.skip('OS isolation unavailable'); return }
  const direct = f.tools().find(tool => tool.name === 'echo_skill')!
  const pending = direct.execute({ text: 'stale' }, f.context)
  const rejection = assert.rejects(pending, /changed/)
  const request = f.permissions.list().find(item => item.state === 'pending')!
  await f.install(['user_chat', 'subagent'], 'Changed instruction')
  f.permissions.resolve(request.id, true)
  await rejection
})
