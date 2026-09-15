import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { migrateDatabase, migrations } from '../src/migrations.ts'

test('database upgrade replaces retired builtin names in every active subagent policy source', () => {
  const database = new DatabaseSync(':memory:')
  const before = migrations.findIndex(sql => sql.includes('CREATE TEMP TABLE retired_builtin_tool_names'))
  assert.ok(before >= 0)
  for (const sql of migrations.slice(0, before)) database.exec(sql)
  database.exec(`PRAGMA user_version=${before}`)
  database.exec(`INSERT INTO sessions VALUES('root','root','local','active',1,1),('child','child','local','active',1,1);
    INSERT INTO subagent_threads(id,root_session_id,parent_session_id,child_session_id,agent_path,task_name,role,depth,state,operation_key,created_at,updated_at,workspace_root)
    VALUES('agent','root','root','child','/root/child','child','worker',1,'completed','fixture',1,1,'');`)
  const policy = JSON.stringify({ sandboxMode: 'inherit', allowedTools: ['eden_read_file', 'read_file', 'eden_exec'], deniedTools: ['eden_exec'], instructions: '' })
  const role = JSON.stringify({ allowedTools: ['eden_attachment'], deniedTools: ['eden_question'] })
  database.prepare('INSERT INTO subagent_policies VALUES(?,?,?)').run('agent', policy, 1)
  database.prepare('INSERT INTO subagent_roles VALUES(?,?,?,?)').run('user', role, 'r1', 1)
  database.prepare('INSERT INTO subagent_project_roles VALUES(?,?,?,?,?)').run('/workspace', 'project', role, 'r2', 1)
  database.prepare('INSERT INTO subagent_role_snapshots VALUES(?,?,?,?)').run('agent', role, '[]', 1)

  migrateDatabase(database)

  const parse = (table: string, column: string) => JSON.parse(String(database.prepare(`SELECT ${column} AS value FROM ${table}`).get()!.value))
  assert.deepEqual(parse('subagent_policies', 'policy_json'), {
    sandboxMode: 'inherit', allowedTools: ['read_file', 'exec_command'], deniedTools: ['exec_command'], instructions: '',
  })
  for (const table of ['subagent_roles', 'subagent_project_roles', 'subagent_role_snapshots']) {
    assert.deepEqual(parse(table, 'definition_json'), { allowedTools: ['read_attachment'], deniedTools: ['request_user_input'] })
  }
  database.close()
})
