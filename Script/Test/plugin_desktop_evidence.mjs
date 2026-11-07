import { readFile, readdir, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const evidence = fileURLToPath(new URL('../../../.run/logs/', import.meta.url))
const fixture = JSON.parse(await readFile(path.join(evidence, 'plugin-desktop-fixture.json'), 'utf8'))
const sessions = []
async function scan(directory, depth = 0) {
  if (depth > 5) return
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, item.name)
    if (item.isDirectory()) { await scan(filename, depth + 1); continue }
    if (item.name !== 'eden-agent.db') continue
    const database = new DatabaseSync(filename, { readOnly: true })
    try {
      if (!database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get()) continue
      for (const session of database.prepare('SELECT id,title,status FROM sessions').all()) {
        const events = database.prepare('SELECT kind,count(*) count FROM events WHERE session_id=? GROUP BY kind').all(session.id)
        const tools = database.prepare('SELECT tool_name,state,count(*) count FROM tool_operations WHERE session_id=? GROUP BY tool_name,state').all(session.id)
        const responses = database.prepare("SELECT payload_json FROM events WHERE session_id=? AND kind='model.response' ORDER BY seq DESC LIMIT 2").all(session.id)
          .map(row => { const payload = JSON.parse(row.payload_json); return { keys: Object.keys(payload), stopReason: payload.stopReason, usage: payload.usage, errorMessage: payload.errorMessage,
            message: payload.message && { keys: Object.keys(payload.message), stopReason: payload.message.stopReason } } })
        const requests = database.prepare("SELECT payload_json FROM events WHERE session_id=? AND kind='model.request' ORDER BY seq DESC LIMIT 1").all(session.id)
          .map(row => { const payload = JSON.parse(row.payload_json); return { keys: Object.keys(payload), model: payload.model && { keys: Object.keys(payload.model), maxTokens: payload.model.maxTokens }, options: payload.options && { maxTokens: payload.options.maxTokens } } })
        const commandResults = process.argv.includes('--commands') ? database.prepare("SELECT state,result_json FROM tool_operations WHERE session_id=? AND tool_name='exec_command'").all(session.id) : undefined
        const modeChanges = database.prepare("SELECT previous_json,value_json,created_at FROM runtime_setting_changes WHERE key='permission.mode'").all()
        sessions.push({ ...session, modelRequests: events.find(item => item.kind === 'model.request')?.count ?? 0,
          events, tools, responses, requests, commandResults, modeChanges })
      }
    } finally { database.close() }
  }
}
await scan(path.join(fixture.root, 'Data/Agent/realms/local'))
await writeFile(path.join(evidence, 'plugin-desktop-evidence.json'), JSON.stringify({ sessions }, null, 2))
console.log(JSON.stringify({ sessions: sessions.map(item => ({ id: item.id, title: item.title,
  modelRequests: item.modelRequests, permissions: item.events.filter(event => event.kind.startsWith('permission.')), tools: item.tools,
  ...(process.argv.includes('--diagnostics') ? { responses: item.responses, requests: item.requests, commands: item.commandResults, modeChanges: item.modeChanges } : {}) })) }, null, 2))
