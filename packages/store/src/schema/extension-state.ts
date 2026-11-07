export const extensionStateSchema = `
CREATE TABLE extension_state (
  account_key TEXT NOT NULL, plugin_id TEXT NOT NULL, component_id TEXT NOT NULL,
  scope_key TEXT NOT NULL, namespace TEXT NOT NULL, key TEXT NOT NULL,
  value_json TEXT, revision INTEGER NOT NULL,
  PRIMARY KEY(account_key,plugin_id,component_id,scope_key,namespace,key)
);
`
