import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EdenDatabase } from '@eden/store'
import { chargeSubagentBudget, recordSubagentRequest, recordSubagentResponse } from '../src/modules/subagent-execution/index.ts'

function fixture() {
  const database = new EdenDatabase(':memory:', 'local'), db = database.connection
  for (const id of ['root', 'parent-session', 'child-session']) db.prepare("INSERT INTO sessions VALUES(?,?,'local','active',1,1)").run(id, id)
  const insert = db.prepare(`INSERT INTO subagent_threads(id,root_session_id,parent_session_id,child_session_id,parent_id,agent_path,
    task_name,role,depth,state,operation_key,created_at,updated_at,workspace_root,max_cost_microusd)
    VALUES(?,'root',?,?,?,?,?,'worker',?,'running',?,1,1,'',10000000)`)
  insert.run('parent', 'root', 'parent-session', null, '/root/parent', 'parent', 1, 'parent-key')
  insert.run('child', 'parent-session', 'child-session', 'parent', '/root/parent/child', 'child', 2, 'child-key')
  return database
}

test('ancestor rejection rolls back child admission; pending model requests block retry', () => {
  const database = fixture(), db = database.connection
  try {
    assert.throws(() => chargeSubagentBudget(database, 'child-session', 'model', true), /transaction/)
    db.prepare("UPDATE subagent_threads SET usage_unknown=1 WHERE id='parent'").run()
    assert.throws(() => database.transaction(() => chargeSubagentBudget(database, 'child-session', 'model', true)), /usage is unknown/)
    assert.equal(db.prepare("SELECT model_requests_used FROM subagent_threads WHERE id='child'").get()?.model_requests_used, 0)
    db.prepare('UPDATE subagent_threads SET usage_unknown=0').run()
    database.transaction(() => {
      chargeSubagentBudget(database, 'child-session', 'model', true)
      recordSubagentRequest(database, 'child-session', 'turn', { requestId: 'request', costConfigured: true })
    })
    assert.throws(() => database.transaction(() => chargeSubagentBudget(database, 'child-session', 'model', true)), /request/i)
    assert.equal(db.prepare('SELECT SUM(model_requests_used) AS n FROM subagent_threads').get()?.n, 2)
  } finally { database.close() }
})

test('correlated responses charge both owners once and unknown usage prevents new admissions', () => {
  const database = fixture(), db = database.connection
  try {
    database.transaction(() => recordSubagentRequest(database, 'child-session', 'turn', { requestId: 'request', costConfigured: true }))
    const response = { requestId: 'request', message: { role: 'assistant', stopReason: 'stop', usage: { totalTokens: 12, costMicrousd: 8 } } }
    for (let index = 0; index < 2; index++) database.transaction(() => recordSubagentResponse(database, 'child-session', 'turn', response))
    for (const row of db.prepare('SELECT tokens_used,cost_microusd_used FROM subagent_threads').all()) {
      assert.equal(row.tokens_used, 12); assert.equal(row.cost_microusd_used, 8)
    }
    database.transaction(() => recordSubagentRequest(database, 'child-session', 'turn-2', { requestId: 'unknown', costConfigured: true }))
    database.transaction(() => recordSubagentResponse(database, 'child-session', 'turn-2', { requestId: 'unknown', message: { role: 'assistant', stopReason: 'error', usage: { totalTokens: 0 } } }))
    assert.throws(() => database.transaction(() => chargeSubagentBudget(database, 'child-session', 'tool')), /usage is unknown/)
  } finally { database.close() }
})
