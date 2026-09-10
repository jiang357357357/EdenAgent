import { CommandService } from '../src/modules/commands/command-service.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { EdenDatabase } from '@eden/store'
import { probeSandbox } from '@eden/execution'
import { WorkspaceService, workspaceTools } from '../src/modules/workspace/index.ts'
import { PermissionService } from '../src/modules/permissions/index.ts'
import { SessionRepository } from '../src/modules/sessions/index.ts'

test('workspace writes and commands wait for approval and execute within the selected directory', async context => {
  if (!(await probeSandbox()).available) { context.skip('Requires OS sandbox'); return }
  const directory = mkdtempSync(path.join(tmpdir(), 'eden-workspace-effects-'))
  const project = path.join(directory, 'project')
  mkdirSync(project)
  const database = new EdenDatabase(':memory:', 'local')
  const sessions = new SessionRepository(database, 'local')
  const session = sessions.create('Effects')
  const permissions = new PermissionService(database, sessions.events)
  const workspace = new WorkspaceService(database, [])
  workspace.switch(project)
  const tools = workspaceTools(workspace, permissions, session.id, session.id, new CommandService(database, []))
  const controller = new AbortController()
  let call = 0
  const execute = (name: string, input: Record<string, unknown>) => tools.find(tool => tool.name === name)!.execute(input, { callId: String(++call), signal: controller.signal })
  const approve = () => permissions.resolve(permissions.list().find(item => item.state === 'pending')!.id, true)
  try {
    const writing = execute('eden_write_file', { path: 'note.md', content: '你好，老师。', createOnly: true })
    assert.equal(existsSync(path.join(project, 'note.md')), false)
    approve()
    await writing
    assert.equal(readFileSync(path.join(project, 'note.md'), 'utf8'), '你好，老师。')
    const info = await workspace.read('note.md')
    assert.equal(info.sha256?.length, 64)
    const stale = execute('eden_write_file', { path: 'note.md', content: 'Wrong update', expectedSha256: '0'.repeat(64) })
    const rejected = assert.rejects(stale, /changed since/)
    approve()
    await rejected
    assert.equal(readFileSync(path.join(project, 'note.md'), 'utf8'), '你好，老师。')
    const command = execute('eden_exec', { command: 'pwd; cat note.md; printf done > result.txt' })
    assert.equal(existsSync(path.join(project, 'result.txt')), false)
    approve()
    const result = await command as { stdout: string; exitCode: number }
    assert.equal(result.exitCode, 0)
    assert.match(result.stdout, /\/workspace/)
    assert.match(result.stdout, /你好，老师。/)
    assert.equal(readFileSync(path.join(project, 'result.txt'), 'utf8'), 'done')
    const escaping = execute('eden_write_file', { path: '../outside.txt', content: 'Escape' })
    const escaped = assert.rejects(escaping, /escapes/)
    approve()
    await escaped
    assert.equal(existsSync(path.join(directory, 'outside.txt')), false)
  } finally { controller.abort(); database.close(); rmSync(directory, { recursive: true }) }
})
