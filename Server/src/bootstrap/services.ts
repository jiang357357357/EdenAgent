import { CommandService } from '../modules/commands/command-service.ts'
import { McpResults, McpLifecycle, mcpTools } from '../modules/mcp/index.ts'
import { ConnectorCredentials, ConnectorCatalog, ConnectorRepository, ConnectorEventRepository, connectorEventTools, ConnectorPermissions, ConnectorLifecycle, connectorCapabilityTools, connectorDiscoveryTools } from '../modules/connectors/index.ts'
import { contactTools } from '../modules/mon/index.ts'
import { MediaService, mediaTools } from '../modules/media/index.ts'
import { VoiceConfigRepository, VoiceService, SpeechRepository, SpeechService, RealtimeVoiceService } from '../modules/voice/index.ts'
import { SubagentRepository, SubagentService, SubagentMailbox, SubagentLifecycle, subagentTools } from '../modules/subagents/index.ts'
import { PluginHookRepository, PluginHookService } from '../modules/plugin-hooks/index.ts'
import { PackageAssets, MarketRepository, MarketService, PackagePreviewRepository, InstalledPackageRepository } from '../modules/plugin-market/index.ts'
import { SkillRepository, SkillService, skillTools } from '../modules/skills/index.ts'
import { DesktopReminderRepository, desktopReminderTools } from '../modules/notifications/index.ts'
import { SelfAwakeRepository, SelfAwakeContext, SelfAwakeBridgeRepository, SelfAwakeBridge, SelfAwakeService, SelfAwakeActions, selfAwakeTools } from '../modules/self-awake/index.ts'
import { JobRepository, JobScheduler } from '../modules/jobs/index.ts'
import { MemoRepository, memoTools, MemoNotifications, memoDispatcher } from '../modules/memos/index.ts'
import { HandoffDispatcher, handoffTools } from '../modules/handoffs/index.ts'
import path from 'node:path'
import type { EdenDatabase } from '@eden/store'
import { PluginService } from '@eden/plugin-host'
import { PermissionService } from '../modules/permissions/index.ts'
import { SessionRepository, SessionService } from '../modules/sessions/index.ts'
import { pluginTools } from '../modules/plugins/index.ts'
import type { ServerConfig } from './config.ts'
import { WorkspaceService, workspaceTools } from '../modules/workspace/index.ts'
import { ModelService, ModelBindingRepository } from '../modules/models/index.ts'
import { MonBindingService } from '../modules/mon/index.ts'
import { DirectorRunRepository, CompanionTurnCoordinator, CompanionSessionExtension } from '../modules/director/index.ts'
import type { RuntimeTool } from '@eden/runtime-pi'
import { QuestionService, questionTool } from '../modules/questions/index.ts'
import { BlobRepository, BlobService } from '../modules/blobs/index.ts'
import { AttachmentService, AttachmentRepository, attachmentTool } from '../modules/attachments/index.ts'
import { MemoryRepository, MemoryScopes, MemoryRecall, memoryTools, MemoryExtractionService } from '../modules/memories/index.ts'

export function createServices(database: EdenDatabase, config: ServerConfig) {
  database.connection.prepare("UPDATE connector_operations SET state='unknown',error='Host restarted before connector result confirmation' WHERE state='running'").run()
  database.connection.prepare("UPDATE mcp_operations SET state='unknown',error='Host restarted before MCP result confirmation' WHERE state='running'").run()
  const connectorCatalog = new ConnectorCatalog()
  const connectors = new ConnectorRepository(database, connectorCatalog)
  const connectorCredentials = new ConnectorCredentials(database, connectors)
  const connectorPermissions = new ConnectorPermissions(database, connectorCatalog, connectors)
  const voiceConfig = new VoiceConfigRepository(database)
  const marketRepository = new MarketRepository(database)
  const pluginMarket = new MarketService(marketRepository, new PackagePreviewRepository(database, marketRepository), new InstalledPackageRepository(database, marketRepository))
  const mcp = new McpLifecycle(pluginMarket.installed)
  const repository = new SessionRepository(database, config.origin)
  const desktopReminders = new DesktopReminderRepository(repository)
  const blobs = new BlobService(path.join(config.dataRoot, 'blobs'), new BlobRepository(database), config.maxBlobBytes)
  const mcpResults = new McpResults(database, blobs)
  const realtimeVoice = new RealtimeVoiceService(repository, voiceConfig, sessionId => mon.realtimeSttUrl(sessionId))
  const voice = new VoiceService(blobs)
  const speech = new SpeechService(new SpeechRepository(database), repository, voiceConfig, blobs, (input, signal) => mon.synthesizeSpeech(input, signal))
  const packageAssets = new PackageAssets(pluginMarket.installed, blobs)
  const attachments = new AttachmentService(blobs)
  const media = new MediaService(repository, attachments)
  const attachmentRepository = new AttachmentRepository(database)
  const selfAwakeRepository = new SelfAwakeRepository(database)
  const selfAwakeContext = new SelfAwakeContext(selfAwakeRepository, repository, config.monIdentity)
  const jobs = new JobRepository(database)
  const connectorEvents = new ConnectorEventRepository(repository, connectors, connectorCatalog, jobs)
  const connectorLifecycle = new ConnectorLifecycle(config.dataRoot, connectors, connectorCatalog, connectorPermissions, connectorEvents, connectorCredentials)
  const memos = new MemoRepository(database, jobs)
  const memoNotifications = new MemoNotifications(database)
  const memories = new MemoryRepository(database)
  const memoryScopes = new MemoryScopes(database)
  const memoryRecall = new MemoryRecall(memories, memoryScopes)
  const directors = new DirectorRunRepository(repository)
  directors.recoverInterrupted()
  const modelBindings = config.origin === 'mon' ? new ModelBindingRepository(database) : undefined
  const models = new ModelService(config.origin, config.model, modelBindings)
  const plugins = new PluginService(database, [config.dataRoot, path.resolve('Data')])
  const commands = new CommandService(database, [config.dataRoot, path.resolve('Data')])
  const workspace = new WorkspaceService(database, [config.dataRoot, path.resolve('Data')])
  const skills = new SkillService(new SkillRepository(database, () => workspace.info().path ? workspace.root() : '', () => pluginMarket.installed.skillContributions()))
  const permissions = new PermissionService(database, repository.events)
  const questions = new QuestionService(repository)
  const tools = (sessionId: string, turnId: string, actorId?: string | number): RuntimeTool[] => [
    ...mcpTools(mcp, database, permissions, sessionId, turnId),
    ...connectorDiscoveryTools(connectors, connectorCatalog, sessionId),
    ...connectorCapabilityTools(database, connectors, connectorCatalog, connectorLifecycle, permissions, sessionId, turnId),
    ...connectorEventTools(connectorEvents, permissions, sessionId, turnId),
    ...mediaTools(media, permissions, sessionId, turnId),
    ...subagentTools(subagents, permissions, sessionId, turnId),
    ...skillTools(skills, permissions, sessionId, turnId, skillProfile(sessionId === '00000000-0000-4000-8000-000000000000' ? null : repository.read(sessionId).environment)),
    ...pluginTools(plugins, permissions, sessionId, turnId), ...workspaceTools(workspace, permissions, sessionId, turnId, commands),
    ...desktopReminderTools(desktopReminders, permissions, sessionId, turnId),
    ...selfAwakeTools(selfAwakeRepository, jobs, permissions, selfAwakeContext, sessionId, turnId),
    questionTool(questions, sessionId, turnId), ...memoTools(memos, permissions, sessionId, turnId),
    attachmentTool(attachmentRepository, attachments, sessionId, turnId),
    ...memoryTools(memories, memoryScopes, permissions, { sessionId, turnId, ...(actorId === undefined ? {} : { actorId }) }),
    ...(config.origin === 'mon' ? contactTools(mon, permissions, sessionId, turnId) : []),
    ...(config.origin === 'mon' ? handoffTools(mon, handoffs.repository, permissions, sessionId, turnId) : []),
  ]
  const companion = new CompanionTurnCoordinator(repository, directors, attachments, memoryRecall)
  const handoffs = new HandoffDispatcher(repository, models, (sessionId, assistantId, signal) => mon.prepareHandoff(sessionId, assistantId, signal), modelBindings)
  const sessions = new SessionService(repository, sessionId => models.resolve(sessionId), tools,
    sessionId => models.invalidateSession(sessionId), new CompanionSessionExtension(companion, models, tools), handoffs, attachments, memoryRecall)
  const mon: MonBindingService = new MonBindingService(models, sessions)
  const selfAwakeBridge = config.monIdentity && config.origin === 'mon' ? new SelfAwakeBridge(config.monIdentity, new SelfAwakeBridgeRepository(database, jobs), sessions, mon) : undefined
  const memoryExtractions = new MemoryExtractionService(repository, models, permissions)
  const selfAwakeActions = new SelfAwakeActions(repository, permissions, memos, desktopReminders, questions, (channel, sessionId, input, signal) => channel === 'qq' ? mon.contactOwnerByQq(sessionId, input, signal) : mon.contactOwnerByEmail(sessionId, input, signal))
  const selfAwake = new SelfAwakeService(selfAwakeRepository, jobs, sessions, () => selfAwakeActions.wake())
  const subagents = new SubagentService(new SubagentRepository(database, jobs), sessions, models, jobs, new SubagentMailbox(database))
  const subagentLifecycle = new SubagentLifecycle(subagents)
  sessions.setDescendantStop(sessionId => subagents.stopChildren(sessionId))
  const pluginHooks = new PluginHookService(new PluginHookRepository(database, jobs), pluginMarket.installed, sessions, jobs)
  const scheduler = new JobScheduler(jobs, { 'subagent.turn': job => subagents.dispatch(job), 'plugin.hook': job => pluginHooks.dispatch(job), self_awake: job => selfAwake.dispatch(job), 'memo.reminder': memoDispatcher(database, memos, memoNotifications, jobs, sessions) })
  return { commands, repository, mcpResults, mcp, connectorCredentials, connectorLifecycle, connectorPermissions, connectorEvents, connectors, connectorCatalog, media, realtimeVoice, speech, voice, voiceConfig, subagentLifecycle, subagents, packageAssets, pluginHooks, pluginMarket, skills, plugins, permissions, sessions, workspace, models, mon, directors, companion, questions, handoffs, blobs, attachments, memories, memos, memoNotifications, jobs, scheduler, selfAwake, selfAwakeActions, selfAwakeBridge, desktopReminders, memoryExtractions }
}

function skillProfile(environment: unknown): string {
  if (environment && typeof environment === 'object' && 'sessionPurpose' in environment && environment.sessionPurpose === 'self_awake') return 'self_awake'
  return 'user_chat'
}
