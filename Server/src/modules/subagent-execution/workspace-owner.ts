import type { EdenDatabase } from '@eden/store'
import { WorkspaceRepository } from '../workspace/index.ts'

export function assertSubagentWorkspace(database: EdenDatabase, sessionId: string): void {
  const row = database.connection.prepare('SELECT workspace_root FROM subagent_threads WHERE child_session_id=?').get(sessionId)
  if (!row) return
  if (row.workspace_root === null) throw new Error('Historical task workspace ownership must be restored')
  if (row.workspace_root !== (new WorkspaceRepository(database).read() ?? '')) throw new Error('Task belongs to another workspace; select its original workspace before continuing')
}

export function restoreSubagentWorkspace(database: EdenDatabase, agentId: string, currentRoot: string) {
  return database.transaction(() => {
    const db = database.connection, row = db.prepare('SELECT * FROM subagent_threads WHERE id=?').get(agentId)
    if (!row) throw new Error('Subagent not found')
    if (['queued', 'running'].includes(String(row.state))) throw new Error('Stop the task before restoring its workspace')
    if (!currentRoot || new WorkspaceRepository(database).read() !== currentRoot) throw new Error('Workspace changed; reload before restoring ownership')
    if (row.workspace_root === currentRoot) return
    if (row.workspace_root !== null && row.workspace_root !== '') throw new Error('Task already belongs to a different workspace; select that workspace')
    if (row.parent_id !== null) {
      const parent = db.prepare('SELECT workspace_root FROM subagent_threads WHERE id=?').get(row.parent_id!)
      if (parent?.workspace_root !== currentRoot) throw new Error('Restore the parent workspace first')
    }
    db.prepare('INSERT INTO subagent_workspace_restorations VALUES(?,?,?,?)').run(agentId, row.workspace_root, currentRoot, Date.now())
    db.prepare('UPDATE subagent_threads SET workspace_root=?,updated_at=? WHERE id=?').run(currentRoot, Date.now(), agentId)
  })
}
