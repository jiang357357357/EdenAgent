/** Snapshot the former account selection for existing sessions without moving their files. */
export const sessionWorkspacesSchema = `CREATE TABLE session_workspaces(
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  settings_json TEXT NOT NULL DEFAULT '{}',revision INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL);
  INSERT INTO session_workspaces(session_id,settings_json,updated_at)
  SELECT s.id,COALESCE((SELECT json_group_object(key,json(value_json)) FROM runtime_settings
    WHERE key IN ('workspace.root','workspace.selection','workspace.selection.default_resolution')), '{}'),s.updated_at
  FROM sessions s;
  ALTER TABLE skill_previews ADD COLUMN session_id TEXT REFERENCES sessions(id);
  ALTER TABLE skill_previews ADD COLUMN workspace_revision TEXT;
  ALTER TABLE subagent_role_imports ADD COLUMN session_id TEXT REFERENCES sessions(id);
  ALTER TABLE subagent_role_imports ADD COLUMN workspace_revision TEXT;`
