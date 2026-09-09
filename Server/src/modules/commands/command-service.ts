import { existsSync } from 'node:fs'
import { commandExecutionConfigSchema, commandExecutionSetSchema, type CommandExecutionConfig } from '@eden/api'
import { probeSandbox, runWorkspaceCommand, runProcess } from '@eden/execution'
import type { EdenDatabase } from '@eden/store'
import { workspaceRoot } from '../workspace/workspace-path.ts'

export class CommandService {
  private active = 0
  private generation = 0
  private probe?: ReturnType<typeof probeSandbox>
  constructor(private readonly database: EdenDatabase, private readonly protectedRoots: readonly string[]) {}

  snapshot() {
    const row = this.database.connection.prepare("SELECT value_json FROM runtime_settings WHERE key='command.execution'").get()
    const config = row ? commandExecutionConfigSchema.parse(JSON.parse(String(row.value_json))) :
      { mode: 'sandbox' as const, networkAccess: false, writableRoots: [] }
    return { config, generation: this.generation }
  }

  async info() {
    const sandbox = await (this.probe ??= probeSandbox())
    const { config } = this.snapshot()
    const hostAvailable = process.platform !== 'win32' && existsSync('/bin/sh')
    return { ...config, available: config.mode === 'host' ? hostAvailable : sandbox.available,
      sandboxAvailable: sandbox.available, sandboxBackend: sandbox.backend, shell: '/bin/sh',
      detail: config.mode === 'host' ? 'Current OS account permissions; filesystem and network are unrestricted. 30-second and 1 MiB output limits apply.' : sandbox.detail }
  }

  async set(raw: unknown) {
    const input = commandExecutionSetSchema.parse(raw)
    if (this.active) throw new Error('Wait for running commands before changing execution boundaries')
    if (input.mode === 'host' && !input.confirmHostExecution) throw new Error('Explicit host execution confirmation is required')
    if (input.mode === 'host' && (process.platform === 'win32' || !existsSync('/bin/sh'))) throw new Error('Host command execution is unavailable on this platform')
    const config: CommandExecutionConfig = { mode: input.mode, networkAccess: input.mode === 'host' ? true : input.networkAccess,
      writableRoots: input.mode === 'host' ? [] : [...new Set(input.writableRoots.map(root => workspaceRoot(root, this.protectedRoots)))] }
    this.database.transaction(() => {
      const previous = this.snapshot().config
      const now = Date.now()
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
      if (config.mode === 'host') return await runProcess({ executable: '/bin/sh', args: ['-c', command], cwd: root,
        input: '', timeoutMs: 30000, maxOutputBytes: 1024 * 1024, signal })
      const sandbox = await (this.probe ??= probeSandbox())
      if (!sandbox.available) throw new Error(`OS sandbox unavailable: ${sandbox.detail}`)
      const writableRoots = config.writableRoots.map(value => {
        const canonical = workspaceRoot(value, this.protectedRoots)
        if (canonical !== value) throw new Error('Writable root changed; configure it again')
        return canonical
      })
      return await runWorkspaceCommand(root, command, signal, { networkAccess: config.networkAccess, writableRoots })
    } finally { this.active-- }
  }
}
