import { DatabaseSync } from 'node:sqlite'
import { readdirSync, existsSync } from 'node:fs'
import path from 'node:path'

/** Reads only saved model configuration; business data is never copied into a test fixture. */
export function configuredPluginTestModel(agentRoot) {
  const accounts = path.join(agentRoot, 'Data/realms/mon/accounts'), candidates = []
  for (const account of existsSync(accounts) ? readdirSync(accounts) : []) {
    const file = path.join(accounts, account, 'storage/eden-agent.db')
    if (!existsSync(file)) continue
    const database = new DatabaseSync(file, { readOnly: true })
    try {
      for (const row of database.prepare('SELECT snapshot_json,updated_at FROM model_bindings ORDER BY updated_at DESC LIMIT 4').all()) {
        const snapshot = JSON.parse(row.snapshot_json)
        const bindings = snapshot.mode === 'single' ? [snapshot.main] : snapshot.actors?.map(actor => actor.main) ?? []
        for (const binding of bindings) if (binding?.model?.apiKey) candidates.push({ model: binding.model, updatedAt: row.updated_at })
      }
    } finally { database.close() }
  }
  const selected = candidates.sort((left, right) => right.updatedAt - left.updatedAt)[0]
  if (!selected) throw new Error('No saved authenticated model configuration is available for the live plugin test')
  return { ...selected.model, maxTokens: Math.min(selected.model.maxTokens, 6144), reasoning: 'off' }
}
