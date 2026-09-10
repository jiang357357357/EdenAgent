import { commandExecutionConfigSchema, commandExecutionSetSchema, type CommandExecutionConfig } from '@eden/api'
import { probeSandbox, runWorkspaceCommand, hostCommandInfo, runHostCommand } from '@eden/execution'
import type { configuredExternalCommandSandbox } from '@eden/execution'
import type { EdenDatabase } from '@eden/store'
import { workspaceRoot } from '@eden/execution'

export class CommandService {
  private active = 0
  private generation = 0
  private probe?: ReturnType<typeof probeSandbox>
  constructor(private readonly database: EdenDatabase, private readonly protectedRoots: readonly string[],
    private readonly external?: ReturnType<typeof configuredExternalCommandSandbox>) { }

  snapshot() {
    const row = this.database.connection.prepare("SELECT value_json FROM runtime_settings WHERE key='command.execution'").get()
    const config = row ? commandExecutionConfigSchema.parse(JSON.parse(String(row.value_json))) :
      { mode: 'sandbox' as const, networkAccess: false, writableRoots: [] }
    return { config, generation: this.generation }
  }

  async info() {
    const sandbox = await (this.probe ??= this.external ? this.external.probe() : probeSandbox())
    const { config } = this.snapshot()
    const host = hostCommandInfo()
    return {
      ...config, available: config.mode === 'host' ? host.available : sandbox.available,
      hostAvailable: host.available, hostShell: host.shell, sandboxAvailable: sandbox.available, sandboxBackend: sandbox.backend, shell: config.mode === 'host' || process.platform === 'win32' ? host.shell : this.external ? '/bin/bash' : '/bin/sh',
      detail: config.mode === 'host' ? 'Current OS account permissions; filesystem and network are unrestricted. 30-second and 1 MiB output limits apply.' : sandbox.detail
    }
  }

  async set(raw: unknown) {
    const input = commandExecutionSetSchema.parse(raw)
    if (this.active) throw new Error('Wait for running commands before changing execution boundaries')
    if (input.mode === 'host' && !input.confirmHostExecution) throw new Error('Explicit host execution confirmation is required')
    if (input.mode === 'host' && !hostCommandInfo().available) throw new Error('Host command execution is unavailable on this platform')
    if (this.external && input.mode === 'sandbox' && (input.networkAccess || input.writableRoots.length)) throw new Error('External sandbox access is configured by its administrator; host network and writable-root overrides are unavailable')
    const config: CommandExecutionConfig = {
      mode: input.mode, networkAccess: input.mode === 'host' ? true : input.networkAccess,
      writableRoots: input.mode === 'host' ? [] : [...new Set(input.writableRoots.map(root => workspaceRoot(root, this.protectedRoots)))]
    }
    this.database.transaction(() => {
      const previous = this.snapshot().config
      const now = Date.now()
      this.database.connection.prepare("UPDATE legacy_app_config SET state='reconfigured',resolution_json=?,resolved_at=? WHERE target_key='command.execution' AND state IN ('confirmation_required','review_required')")
        .run(JSON.stringify(config), now)
      this.database.connection.prepare('INSERT OR REPLACE INTO runtime_settings VALUES (?, ?, ?)').run('command.execution', JSON.stringify(config), now)
      this.database.connection.prepare('INSERT INTO runtime_setting_changes(key,previous_json,value_json,created_at) VALUES (?, ?, ?, ?)')
        .run('command.execution', JSON.stringify(previous), JSON.stringify(config), now)
    })
    this.generation++
    return this.info()
  }

  async execute(snapshot: ReturnType<CommandService['snapshot']>, root: string, command: string, signal: AbortSignal) {
    signal.throwIfAborted()
    if (snapshot.generation !== this.generation) throw new Error('Execution boundary changed after approval; submit the command again')
    this.active++
    try {
      const config = snapshot.config
      if (config.mode === 'host') return await runHostCommand(root, command, signal)
      const sandbox = await (this.probe ??= this.external ? this.external.probe() : probeSandbox())
      if (!sandbox.available) throw new Error(`OS sandbox unavailable: ${sandbox.detail}`)
      if (this.external) {
        if (config.networkAccess || config.writableRoots.length) throw new Error('Clear incompatible command access overrides before using the external sandbox')
        return await this.external.run(root, command, signal)
      }
      const writableRoots = config.writableRoots.map(value => {
        const canonical = workspaceRoot(value, this.protectedRoots)
        if (canonical !== value) throw new Error('Writable root changed; configure it again')
        return canonical
      })
      return await runWorkspaceCommand(root, command, signal, { networkAccess: config.networkAccess, writableRoots })
    } finally { this.active-- }
  }
}
