import type { JsonValue } from '@eden/api'

const allowed = new Set([
  'ping', 'runtime.status', 'migration.status', 'session.list', 'session.read', 'event.list', 'message.list',
  'workspace.info', 'workspace.switch', 'workspace.list', 'workspace.read',
  'model.read', 'model.catalog', 'model.select', 'model.pricing.read', 'model.pricing.set',
  'mon.sync.status', 'mon.operation.list', 'mon.sync.legacy.resolve',
  'operation.list', 'operation.resolve', 'job.list', 'job.page', 'job.read', 'job.cancel', 'job.resolve',
  'input.recovery.list', 'input.recovery.resolve',
  'input.resubmission.preview',
  'self_awake.list', 'self_awake.execution', 'self_awake.job.preview',
  'self_awake.notification.review', 'self_awake.notification.resolve',
  'self_awake.run.review', 'self_awake.run.resolve',
  'agent.list', 'agent.read', 'agent.recovery.read', 'agent.recovery.policy', 'agent.requests.list', 'agent.requests.review', 'agent.workspace.restore',
  'agent.recovery.model.sources',
  'agent.recovery.model.preview', 'agent.recovery.model.apply',
  'agent.recovery.usage.preview', 'agent.recovery.usage.apply',
  'agent.recovery.reopen',
  'agent.recovery.deadline',
  'agent.recovery.mailbox.list', 'agent.recovery.mailbox.resolve',
  'agent.recovery.mailbox.followup.preview',
  'agent.recovery.mailbox.followup.abandon',
  'agent.roles', 'agent.roles.edit', 'agent.roles.save', 'agent.roles.remove', 'agent.roles.import.preview', 'agent.roles.import.apply',
  'permission.list', 'permission.mode.get', 'permission.mode.set', 'permission.grant.revoke',
  'skill.catalog_status', 'skill.list', 'skill.read', 'skill.inspect', 'skill.install_preview', 'skill.install', 'skill.enable', 'skill.uninstall', 'skill.file',
  'plugin.recovery.list', 'plugin.recovery.permissions', 'plugin.recovery.inspect', 'plugin.preview.discard',
  'plugin.list', 'plugin.read', 'plugin.version.list', 'plugin.version.read', 'plugin.install_preview', 'plugin.permissions.set',
  'plugin.market.source.list', 'plugin.market.key.list', 'plugin.market.key.add', 'plugin.market.key.revoke',
])

/** Explicit allowlist: new business methods cannot accidentally start execution during recovery. */
export function reviewRoutes(routes: Record<string, (params: JsonValue) => JsonValue | Promise<JsonValue>>) {
  return Object.fromEntries(Object.entries(routes).filter(([name]) => allowed.has(name)))
}
