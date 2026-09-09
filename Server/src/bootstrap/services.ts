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
  const repository = new SessionRepository(database, config.origin)
  const blobs = new BlobService(path.join(config.dataRoot, 'blobs'), new BlobRepository(database), config.maxBlobBytes)
  const attachments = new AttachmentService(blobs)
  const attachmentRepository = new AttachmentRepository(database)
  const memories = new MemoryRepository(database)
  const memoryScopes = new MemoryScopes(database)
  const memoryRecall = new MemoryRecall(memories, memoryScopes)
  const directors = new DirectorRunRepository(repository)
  directors.recoverInterrupted()
  const modelBindings = config.origin === 'mon' ? new ModelBindingRepository(database) : undefined
  const models = new ModelService(config.origin, config.model, modelBindings)
  const plugins = new PluginService(database, [config.dataRoot, path.resolve('Data')])
  const workspace = new WorkspaceService(database, [config.dataRoot, path.resolve('Data')])
  const permissions = new PermissionService(database, repository.events)
  const questions = new QuestionService(repository)
  const tools = (sessionId: string, turnId: string, actorId?: string | number): RuntimeTool[] => [
    ...pluginTools(plugins, permissions, sessionId, turnId), ...workspaceTools(workspace, permissions, sessionId, turnId),
    questionTool(questions, sessionId, turnId),
    attachmentTool(attachmentRepository, attachments, sessionId, turnId),
    ...memoryTools(memories, memoryScopes, permissions, { sessionId, turnId, ...(actorId === undefined ? {} : { actorId }) }),
    ...(config.origin === 'mon' ? handoffTools(mon, handoffs.repository, permissions, sessionId, turnId) : []),
  ]
  const companion = new CompanionTurnCoordinator(repository, directors, attachments, memoryRecall)
  const handoffs = new HandoffDispatcher(repository, models, (sessionId, assistantId, signal) => mon.prepareHandoff(sessionId, assistantId, signal), modelBindings)
  const sessions = new SessionService(repository, sessionId => models.resolve(sessionId), tools,
    sessionId => models.invalidateSession(sessionId), new CompanionSessionExtension(companion, models, tools), handoffs, attachments, memoryRecall)
  const mon: MonBindingService = new MonBindingService(models, sessions)
  const memoryExtractions = new MemoryExtractionService(repository, models, permissions)
  return { repository, plugins, permissions, sessions, workspace, models, mon, directors, companion, questions, handoffs, blobs, attachments, memories, memoryExtractions }
}
