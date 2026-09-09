// Compatibility baseline migrated from the archived Rust-generated client.
// Temporary wire contract; replace domains with schema-derived types during B6.

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type CommandExecutionMode = "sandbox" | "host";

export type CommandExecutionInfo = { mode: CommandExecutionMode, networkAccess: boolean, writableRoots: Array<string>, available: boolean, sandboxAvailable: boolean, sandboxBackend: string, shell: string, detail: string, };

export type CommandExecutionSetParams = { mode: CommandExecutionMode, confirmHostExecution: boolean, networkAccess: boolean, writableRoots: Array<string>, };

export type SessionId = string;

export type TurnId = string;

export type ItemId = string;

export type AgentId = string;

export type ToolCallId = string;

export type OperationId = string;

export type PermissionRequestId = string;

export type QuestionRequestId = string;

export type BlobId = string;

export type RpcRequest = { jsonrpc: string, id?: JsonValue | null, method: string, params: JsonValue, };

export type RpcResponse = { jsonrpc: string, id: JsonValue, result: JsonValue | null, error: RpcError | null, };

export type RpcError = { code: number, message: string, data?: JsonValue | null, };

export type RpcNotification = { jsonrpc: string, method: string, params: JsonValue, };

export type RuntimeOrigin = "mon" | "local";

export type InitializeParams = { protocolVersion: number, clientName: string, clientVersion: string, capabilities: Array<string>, runtimeOrigin: RuntimeOrigin, };

export type InitializeResult = { protocolVersion: number, serverName: string, serverVersion: string, agentCoreVersion: string, capabilities: Array<string>, runtimeOrigin: RuntimeOrigin, };

export type ReadyNotification = { connectionId: string, };

export type SessionEnvironmentLocation = { country: string, region: string, city: string, district: string, latitude?: number | null, longitude?: number | null, };

export type SessionEnvironment = { timezone: string, locale: string, location: SessionEnvironmentLocation, };

export type SessionCreateParams = { title: string, participants: Array<SessionParticipant>, environment?: SessionEnvironment | null, };

export type SessionParticipant = { assistantId: JsonValue, assistantName: string, characterId?: JsonValue | null, characterName: string, signature: string, avatarUrl: string, standingImageUrl: string, ttsConfigId?: bigint | null, sttConfigId?: bigint | null, position: bigint, profile?: JsonValue | null, };

export type SessionParticipantsParams = { sessionId: SessionId, participants: Array<SessionParticipant>, };

export type SessionReadParams = { sessionId: SessionId, };

export type SessionTitleParams = { sessionId: SessionId, title: string, };

export type SessionCompactParams = { sessionId: SessionId, instructions: string, };

export type SessionListParams = { limit: number, includeClosed: boolean, };

export type SessionStatus = "active" | "closed";

export type SessionSummary = { id: SessionId, title: string, titleSource: string, status: SessionStatus, runtimeOrigin: RuntimeOrigin, participants: Array<SessionParticipant>, environment?: SessionEnvironment | null, contextTokens?: bigint | null, tokenBreakdown?: TokenBreakdown | null, createdAt: bigint, updatedAt: bigint, };

export type TokenBreakdown = { character: bigint, skills: bigint, system: bigint, tools: bigint, history: bigint, cacheRead: bigint, cacheMiss: bigint, cacheHitRate: number, providerInput?: bigint | null, providerOutput?: bigint | null, providerAdjustment: bigint, contextMeasurement?: string | null, promptCacheFingerprint?: string | null, promptCacheEpoch: bigint, promptCacheInvalidationReason?: string | null, tokenizer?: string | null, tokenizerModel?: string | null, };

export type AttachmentRef = { blobId: BlobId, mime: string, filename?: string | null, };

export type BlobInfo = { id: BlobId, sha256: string, mime: string, byteLength: bigint, createdAt: bigint, };

export type GsvTtsConfig = { provider: string, serviceUrl: string, version: string, world: string, role: string, roleId: string, emotion: string, textLanguage: string, speed: number, timeoutSeconds: number, topK: number, topP: number, temperature: number, sampleSteps: number, pauseSeconds: number, cutMethod: string, superResolution: boolean, referenceFree: boolean, freeze: boolean, };

export type GsvSttConfig = { provider: string, serviceUrl: string, language: string, modelType: string, modelSize: string, precision: string, timeoutSeconds: number, retryCount: number, endSilenceMs: number, sessionEndSilenceMs: number, autoFinish: boolean, autoSend: boolean, minSpeechDurationMs: number, speechNoiseThreshold: number, prerollMs: number, chunkMs: number, };

export type VoiceRuntimeConfig = { tts: GsvTtsConfig, stt: GsvSttConfig, };

export type GsvDiscoveryStage = "all" | "catalog" | "worlds" | "roles" | "emotions";

export type GsvDiscoveryParams = { config: GsvTtsConfig, stage: GsvDiscoveryStage, };

export type GsvOption = { id: string, label: string, value: string, };

export type GsvDiscoveryResult = { ok: boolean, latencyMs: number, versions: Array<GsvOption>, worlds: Array<GsvOption>, roles: Array<GsvOption>, emotions: Array<GsvOption>, selectedRoleId: string, };

export type GsvPreviewParams = { config: GsvTtsConfig, text: string, };

export type GsvPreviewResult = { ok: boolean, audioBlobId: BlobId, mime: string, durationMs?: bigint | null, latencyMs: number, roleId: string, };

export type GsvSttTestParams = { config: GsvSttConfig, };

export type GsvConnectionTestResult = { ok: boolean, latencyMs: number, };

export type ModelCatalogParams = { coreBaseUrl: string, coreToken: string, sessionId?: SessionId | null, };

export type ModelReadParams = { sessionId?: SessionId | null, };

export type ModelSelectParams = { coreBaseUrl: string, coreToken: string, aiEntityId: JsonValue, sessionId?: SessionId | null, };

export type RuntimeModelInfo = { id: string, provider: string, api: string, baseUrl?: string | null, contextWindow?: bigint | null, maxTokens?: bigint | null, source: string, aiEntityId?: JsonValue | null, label: string, available: boolean, error?: string | null, };

export type RuntimeModelIdentityInfo = { id: JsonValue, name: string, };

export type RuntimeModelOptionInfo = { id: string, aiEntityId: JsonValue, label: string, name: string, provider: string, providerName: string, providerIcon: string, supportedModels: Array<string>, modelID: string, status: string, isMultimodal: boolean, isChoiceDefault: boolean, isVisionDefault: boolean, contextWindow: bigint, selected: boolean, };

export type RuntimeModelCatalogInfo = { source: string, serviceType: string, vendors: JsonValue, assistant: RuntimeModelIdentityInfo, character: RuntimeModelIdentityInfo, current?: RuntimeModelOptionInfo | null, vision?: RuntimeModelOptionInfo | null, selectionSource: string, options: Array<RuntimeModelOptionInfo>, actors: Array<JsonValue>, };

export type SkillListParams = Record<symbol, never>;

export type SkillReadParams = { name: string, };

export type SkillInfo = { name: string, displayName: string, description: string, version: string, modelInvocable: boolean, enabled: boolean, available: boolean, missingTools: Array<string>, scope: string, sourceType: string, tools: Array<string>, profiles: Array<string>, permissions: Array<string>, defaultPrompt: string, contentHash: string, totalBytes: bigint, files: Array<string>, manifest: JsonValue, content?: string | null, };

export type SkillInstallParams = { name: string, description: string, content: string, };

export type SkillEnableParams = { name: string, enabled: boolean, };

export type SkillInspectParams = { sourceType: string, sourceUri: string, sourceRef?: string | null, sourceSubpath?: string | null, scope: string, };

export type SkillPreviewInstallParams = { previewId: string, };

export type SkillPreviewSource = { type: string, uri: string, ref: string, subpath: string, };

export type SkillPreviewInfo = { previewID: string, skillName: string, displayName: string, description: string, version: string, scope: string, source: SkillPreviewSource, tools: Array<string>, profiles: Array<string>, modelInvocable: boolean, contentHash: string, fileCount: bigint, totalBytes: bigint, expiresAt: bigint, };

export type PluginListParams = Record<symbol, never>;

export type PluginReadParams = { id: string, };

export type PluginInspectParams = { sourceType: string, sourceUri: string, };

export type PluginPreviewInstallParams = { previewID: string, activate: boolean, enabled: boolean, requireVerified: boolean, };

export type PluginEnableParams = { id: string, enabled: boolean, };

export type PluginActivateParams = { id: string, version: string, revision: string, };

export type PluginUninstallResult = { id: string, deleted: boolean, removedVersions: bigint, cleanupErrors: Array<string>, };

export type PluginComponentInfo = { id: string, kind: string, path: string, enabledByDefault: boolean, };

export type PluginUiContributionInfo = { componentId: string, id: string, location: string, title: string, body: string, tone: string, };

export type PluginPermissionInfo = { capability: string, resource: string, access: string, required: boolean, description: string, };

export type PluginPermissionDecision = { capability: string, resource: string, access: string, decision: string, };

export type PluginPermissionSetParams = { id: string, revision: string, decisions: Array<PluginPermissionDecision>, };

export type PluginPermissionGrantInfo = { capability: string, resource: string, access: string, decision: string, manifestRevision: string, decidedAt: bigint, };

export type PluginMarketSourceAddParams = { id: string, name: string, url: string, keyID: string, enabled: boolean, };

export type PluginMarketSourceParams = { id: string, };

export type PluginMarketListParams = { sourceID?: string | null, };

export type PluginMarketInspectParams = { sourceID: string, pluginID: string, version: string, };

export type PluginMarketSourceInfo = { id: string, name: string, url: string, keyID: string, enabled: boolean, indexRevision: string | null, lastRefreshedAt: bigint | null, lastError: string | null, };

export type PluginMarketReleaseInfo = { sourceID: string, pluginID: string, name: string, description: string, version: string, revision: string, revoked: boolean, revocationReason: string | null, };

export type PluginVersionInfo = { version: string, revision: string, active: boolean, trustState: string, sourceType: string, sourceUri: string, installedAt: bigint, };

export type PluginInfo = { id: string, name: string, description: string, version: string, revision: string, enabled: boolean, trustState: string, sourceType: string, sourceUri: string, components: Array<PluginComponentInfo>, uiContributions: Array<PluginUiContributionInfo>, permissions: Array<PluginPermissionInfo>, permissionGrants: Array<PluginPermissionGrantInfo>, versions: Array<PluginVersionInfo>, manifest: JsonValue, createdAt: bigint, updatedAt: bigint, };

export type PluginPreviewInfo = { previewID: string, id: string, name: string, description: string, version: string, revision: string, verified: boolean, sourceType: string, sourceUri: string, components: Array<PluginComponentInfo>, permissions: Array<PluginPermissionInfo>, expiresAt: bigint, };

export type AgentListParams = { sessionId: SessionId, };

export type AgentReadParams = { agentId: AgentId, };

export type AgentMessageParams = { agentId: AgentId, message: string, };

export type AgentThreadStatus = "queued" | "running" | "completed" | "failed" | "interrupted";

export type AgentThreadResultInfo = { content: string, summary?: string | null, artifacts: Array<JsonValue>, changedFiles: Array<string>, tests: Array<JsonValue>, details?: JsonValue | null, };

export type AgentThreadInfo = { id: AgentId, sessionId: SessionId, parentId: AgentId | null, agentPath: string, taskName: string, role: string, status: AgentThreadStatus, result: AgentThreadResultInfo | null, error: string | null, createdAt: bigint, updatedAt: bigint, startedAt: bigint | null, completedAt: bigint | null, config: JsonValue, usage: JsonValue, deadlineAt: bigint | null, coordinationBatchId: string | null, };

export type TurnStartParams = { sessionId: SessionId, text: string, attachments: Array<AttachmentRef>, environment?: SessionEnvironment | null, };

export type TurnQueueParams = { sessionId: SessionId, text: string, };

export type TurnQueueResult = { sessionId: SessionId, state: string, turnId?: TurnId | null, inputId?: OperationId | null, };

export type TurnAccepted = { sessionId: SessionId, turnId: TurnId, inputId: OperationId, state: string, };

export type EventListParams = { sessionId: SessionId, afterSeq: bigint, limit: number, };

export type MessageListParams = { sessionId: SessionId, before?: string | null, limit: number, };

export type SessionEvent = { id: string, sessionId: SessionId, seq: bigint, turnId?: TurnId | null, eventType: string, payload: JsonValue, createdAt: bigint, };

export type EventPage = { items: Array<SessionEvent>, nextCursor?: string | null, hasMore: boolean, };

export type PermissionDecision = "once" | "always" | "deny";

export type PermissionResolveParams = { requestId: PermissionRequestId, decision: PermissionDecision, message?: string | null, };

export type PermissionListParams = { sessionId?: SessionId | null, };

export type PermissionRequestInfo = { id: PermissionRequestId, sessionId: SessionId, turnId: TurnId, operationId: OperationId, capability: string, resource: string, state: string, request: JsonValue, createdAt: bigint, };

export type OperationDecision = "retry" | "abandon";

export type OperationListParams = { sessionId?: SessionId | null, state?: string | null, limit: number, };

export type OperationResolveParams = { operationId: OperationId, decision: OperationDecision, };

export type OperationInfo = { operationId: OperationId, sessionId: SessionId, turnId: TurnId, toolCallId: string, toolName: string, capability: string, resource: string, state: string, request: JsonValue, result?: JsonValue | null, error?: JsonValue | null, createdAt: bigint, updatedAt: bigint, };

export type QuestionListParams = { sessionId?: SessionId | null, };

export type QuestionResolveParams = { requestId: QuestionRequestId, answers: Array<Array<string>>, };

export type QuestionRejectParams = { requestId: QuestionRequestId, };

export type QuestionOptionInfo = { label: string, description: string, };

export type QuestionItemInfo = { header: string, question: string, options: Array<QuestionOptionInfo>, multiple?: boolean | null, custom?: boolean | null, };

export type QuestionRequestInfo = { id: QuestionRequestId, sessionId: SessionId, turnId: TurnId, state: string, questions: Array<QuestionItemInfo>, createdAt: bigint, };

export type MemoListParams = { limit: number, query?: string | null, };

export type MemoCreateParams = { title: string, content: string, kind: string, status: string, priority: string, remindAt?: bigint | null, dueAt?: bigint | null, repeatRule: string, relatedSessionId: string, metadata: JsonValue, };

export type MemoUpdateParams = { id: bigint, patch: JsonValue, };

export type MemoIdParams = { id: bigint, };

export type MemoInfo = { id: bigint, title: string, content: string, kind: string, status: string, priority: string, remindAt: bigint | null, dueAt: bigint | null, repeatRule: string, relatedSessionId: string, lastTriggeredAt: bigint | null, completedAt: bigint | null, metadata: JsonValue, createdAt: bigint, updatedAt: bigint, };

export type ConnectorCreateParams = { connectorKey: string, identityKey: string, displayName: string, desiredState: string, settings: JsonValue, };

export type ConnectorUpdateParams = { id: string, patch: JsonValue, };

export type ConnectorInfo = { id: string, connectorKey: string, identityKey: string, displayName: string, desiredState: string, runtimeState: string, settings: JsonValue, lastError: string | null, createdAt: bigint, updatedAt: bigint, };

export type ConnectorCapabilityInvocation = { tool: string, action?: string | null, query?: string | null, };

export type ConnectorCapabilityInfo = { id: string, kind: string, direction: string, label: string, description: string, schema: JsonValue, invocation?: ConnectorCapabilityInvocation | null, };

export type ConnectorCatalogEntry = { key: string, name: string, description: string, icon: string, version: string, revision: string, hot_reload: boolean, worker_isolated: boolean, settings_schema: JsonValue, capabilities: Array<ConnectorCapabilityInfo>, };

export type ConnectorCatalogError = { key: string, error: string, };

export type ConnectorCatalogInfo = { connectors: Array<ConnectorCatalogEntry>, errors: Array<ConnectorCatalogError>, };

export type MediaListParams = { kind?: string | null, };

export type MediaResolveParams = { id: string, result?: JsonValue | null, error?: string | null, };

export type MediaRequestInfo = { id: string, sessionId: SessionId, kind: string, state: string, request: JsonValue, createdAt: bigint, };

export type WorkspaceInfo = { name: string, path: string, pendingPath?: string | null, requestedAt?: bigint | null, };

export type WorkspaceSwitchParams = { sessionId: SessionId, path: string, };

export type WorkspaceSwitchResult = { currentPath: string, pendingPath?: string | null, pendingSessionId?: SessionId | null, requestedAt?: bigint | null, updatedAt: bigint, };

export type WorkspacePathParams = { path: string, };

export type WorkspaceEntryKind = "directory" | "file";

export type WorkspaceEntryInfo = { name: string, path: string, type: WorkspaceEntryKind, size?: bigint | null, };

export type WorkspaceDirectoryInfo = { root: string, path: string, entries: Array<WorkspaceEntryInfo>, };

export type WorkspaceFileInfo = { name: string, path: string, size: bigint, binary: boolean, truncated: boolean, content: string, };

export type ToolExecutionModeInfo = "sequential" | "parallel";

export type ToolExposureInfo = "direct" | "deferred" | "hidden";

export type ToolInfo = { name: string, label: string, description: string, parameters: JsonValue, outputSchema?: JsonValue | null, source: string, version: string, namespace: string, executionMode: ToolExecutionModeInfo, exposure: ToolExposureInfo, };

export type SelfAwakeListParams = { page: number, pageSize: number, query?: string | null, };

export type SelfAwakeDiaryInfo = { id: string, runId: string, sessionId: SessionId, assistantId: string, characterId: string, title: string, content: string, mood: string, metadata: JsonValue, createdAt: bigint, };

export type SelfAwakeRunInfo = { id: string, jobId: string, sessionId: SessionId, schemaVersion: string, eventId: string, status: string, request: JsonValue, decision?: JsonValue | null, authorSnapshot: JsonValue, attempts: bigint, lastError?: string | null, startedAt?: bigint | null, completedAt?: bigint | null, createdAt: bigint, updatedAt: bigint, diaries: Array<SelfAwakeDiaryInfo>, };

export type SelfAwakeScheduleInfo = { status: string, nextWakeAt: string | null, reason: string, };

export type SelfAwakePage = { schedule: SelfAwakeScheduleInfo | null, count: bigint, page: number, pageSize: number, totalPages: number, results: Array<SelfAwakeRunInfo>, };

export type SelfAwakeExecutionParams = { runId: string, };

export type SelfAwakeExecutionInfo = { path: string, record: JsonValue, };

export type DirectorListParams = { sessionId: SessionId, };

export type DirectorBeatInfo = { assistantID: JsonValue, intent: string, speechAct: string, addressTo: string, replyToBeat?: number | null, };

export type DirectorSceneInfo = { domain: string, interactionType: string, confidence: number, summary: string, };

export type DirectorExecutionInfo = { mode: string, leadAssistantID?: JsonValue | null, toolOwnerAssistantID?: JsonValue | null, observationStrategy: string, };

export type DirectorRunStatus = "planned" | "running" | "completed" | "failed";

export type DirectorRunInfo = { planID: string, userMessageID?: string | null, source: string, diagnostic?: string | null, scene?: DirectorSceneInfo | null, execution?: DirectorExecutionInfo | null, beats: Array<DirectorBeatInfo>, status: DirectorRunStatus, activeBeatIndex?: number | null, completedBeatIndexes: Array<number>, participantCount?: number | null, error?: string | null, createdAt: bigint, updatedAt: bigint, };

export type VoiceTtsSynthesizeParams = { sessionId: SessionId, messageId: string, segmentGroupId: string, groupIndex: number, sequence: number, text: string, configId: bigint, mode: VoiceTtsMode, };

export type VoiceTtsMode = "text_only" | "all";

export type VoiceTtsSynthesizeResult = { success: boolean, audio_url?: string | null, audio_blob_id?: BlobId | null, text?: string | null, cached?: boolean | null, cache_key?: string | null, audio_format?: string | null, duration_ms?: bigint | null, size_bytes?: bigint | null, speech_segment_id?: bigint | null, segment_group_id?: string | null, group_index?: number | null, sequence?: number | null, error_message?: string | null, };

export type VoiceSpeechSegmentListParams = { sessionId: SessionId, messageId?: string | null, };

export type VoiceSpeechSegmentInfo = { id: bigint, external_message_id: string, audio_asset_id: bigint, audio_url: string, audio_blob_id?: BlobId | null, duration_ms?: bigint | null, audio_format: string, segment_group_id: string, group_index: number, sequence: number, text_hash: string, text_length: number, };

export interface RpcMethodMap {
  initialize: { params: InitializeParams; result: InitializeResult }
  ping: { params: Record<string, never>; result: { pong: boolean } }
  "session.create": { params: SessionCreateParams; result: SessionSummary }
  "session.list": { params: SessionListParams; result: SessionSummary[] }
  "session.read": { params: SessionReadParams; result: SessionSummary }
  "session.rename": { params: SessionTitleParams; result: SessionSummary }
  "session.set_participants": { params: SessionParticipantsParams; result: SessionSummary }
  "session.close": { params: SessionReadParams; result: { sessionId: SessionId; closed: boolean } }
  "session.delete": { params: SessionReadParams; result: { sessionId: SessionId; deleted: boolean } }
  "session.compact": { params: SessionCompactParams; result: TurnAccepted }
  "turn.start": { params: TurnStartParams; result: TurnAccepted }
  "turn.steer": { params: TurnQueueParams; result: TurnQueueResult }
  "turn.follow_up": { params: TurnQueueParams; result: TurnQueueResult }
  "turn.cancel": { params: SessionReadParams; result: { sessionId: SessionId; cancellationRequested: boolean } }
  "event.list": { params: EventListParams; result: EventPage }
  "message.list": { params: MessageListParams; result: EventPage }
  "permission.list": { params: PermissionListParams; result: PermissionRequestInfo[] }
  "permission.mode.get": { params: Record<string, never>; result: { mode: "restricted" | "full_access" | "takeover" } }
  "command.execution.get": { params: Record<string, never>; result: CommandExecutionInfo }
  "command.execution.set": { params: CommandExecutionSetParams; result: CommandExecutionInfo }
  "permission.mode.set": { params: { mode: "restricted" | "full_access" | "takeover" }; result: { mode: "restricted" | "full_access" | "takeover" } }
  "permission.resolve": { params: PermissionResolveParams; result: PermissionRequestInfo }
  "operation.list": { params: OperationListParams; result: OperationInfo[] }
  "operation.resolve": { params: OperationResolveParams; result: OperationInfo }
  "question.list": { params: QuestionListParams; result: QuestionRequestInfo[] }
  "question.resolve": { params: QuestionResolveParams; result: QuestionRequestInfo }
  "question.reject": { params: QuestionRejectParams; result: QuestionRequestInfo }
  "skill.list": { params: SkillListParams; result: SkillInfo[] }
  "skill.read": { params: SkillReadParams; result: SkillInfo }
  "skill.install": { params: SkillInstallParams; result: SkillInfo }
  "skill.enable": { params: SkillEnableParams; result: SkillInfo }
  "skill.uninstall": { params: SkillReadParams; result: { deleted: boolean } }
  "skill.inspect": { params: SkillInspectParams; result: SkillPreviewInfo }
  "skill.install_preview": { params: SkillPreviewInstallParams; result: SkillInfo }
  "plugin.list": { params: PluginListParams; result: PluginInfo[] }
  "plugin.read": { params: PluginReadParams; result: PluginInfo }
  "plugin.inspect": { params: PluginInspectParams; result: PluginPreviewInfo }
  "plugin.install_preview": { params: PluginPreviewInstallParams; result: PluginInfo }
  "plugin.enable": { params: PluginEnableParams; result: PluginInfo }
  "plugin.activate": { params: PluginActivateParams; result: PluginInfo }
  "plugin.uninstall": { params: PluginReadParams; result: PluginUninstallResult }
  "plugin.permissions.set": { params: PluginPermissionSetParams; result: PluginInfo }
  "plugin.market.source.list": { params: PluginListParams; result: PluginMarketSourceInfo[] }
  "plugin.market.source.add": { params: PluginMarketSourceAddParams; result: PluginMarketSourceInfo }
  "plugin.market.source.remove": { params: PluginMarketSourceParams; result: { deleted: boolean } }
  "plugin.market.source.refresh": { params: PluginMarketSourceParams; result: PluginMarketSourceInfo }
  "plugin.market.list": { params: PluginMarketListParams; result: PluginMarketReleaseInfo[] }
  "plugin.market.inspect": { params: PluginMarketInspectParams; result: PluginPreviewInfo }
  "agent.list": { params: AgentListParams; result: AgentThreadInfo[] }
  "agent.read": { params: AgentReadParams; result: AgentThreadInfo }
  "agent.interrupt": { params: AgentReadParams; result: AgentThreadInfo }
  "agent.send": { params: AgentMessageParams; result: AgentThreadInfo }
  "agent.followup": { params: AgentMessageParams; result: AgentThreadInfo }
  "memo.list": { params: MemoListParams; result: MemoInfo[] }
  "memo.create": { params: MemoCreateParams; result: MemoInfo }
  "memo.update": { params: MemoUpdateParams; result: MemoInfo }
  "memo.complete": { params: MemoIdParams; result: MemoInfo }
  "memo.archive": { params: MemoIdParams; result: MemoInfo }
  "connector.list": { params: Record<string, never>; result: ConnectorInfo[] }
  "connector.catalog": { params: Record<string, never>; result: ConnectorCatalogInfo }
  "connector.create": { params: ConnectorCreateParams; result: ConnectorInfo }
  "connector.update": { params: ConnectorUpdateParams; result: ConnectorInfo }
  "workspace.info": { params: Record<string, never>; result: WorkspaceInfo }
  "workspace.switch": { params: WorkspaceSwitchParams; result: WorkspaceSwitchResult }
  "workspace.list": { params: WorkspacePathParams; result: WorkspaceDirectoryInfo }
  "workspace.read": { params: WorkspacePathParams; result: WorkspaceFileInfo }
  "tool.list": { params: Record<string, never>; result: ToolInfo[] }
  "model.read": { params: ModelReadParams; result: RuntimeModelInfo }
  "model.catalog": { params: ModelCatalogParams; result: RuntimeModelCatalogInfo }
  "model.select": { params: ModelSelectParams; result: RuntimeModelCatalogInfo }
  "media.list": { params: MediaListParams; result: MediaRequestInfo[] }
  "media.resolve": { params: MediaResolveParams; result: MediaRequestInfo }
  "voice.config.read": { params: Record<string, never>; result: VoiceRuntimeConfig }
  "voice.tts.config.update": { params: GsvTtsConfig; result: VoiceRuntimeConfig }
  "voice.stt.config.update": { params: GsvSttConfig; result: VoiceRuntimeConfig }
  "voice.gsv.discover": { params: GsvDiscoveryParams; result: GsvDiscoveryResult }
  "voice.gsv.preview": { params: GsvPreviewParams; result: GsvPreviewResult }
  "voice.stt.test": { params: GsvSttTestParams; result: GsvConnectionTestResult }
  "voice.tts.synthesize": { params: VoiceTtsSynthesizeParams; result: VoiceTtsSynthesizeResult }
  "voice.tts.list_segments": { params: VoiceSpeechSegmentListParams; result: VoiceSpeechSegmentInfo[] }
  "self_awake.execution": { params: SelfAwakeExecutionParams; result: SelfAwakeExecutionInfo }
  "self_awake.list": { params: SelfAwakeListParams; result: SelfAwakePage }
  "director.list": { params: DirectorListParams; result: DirectorRunInfo[] }
}

export interface RpcNotificationMap {
  "server.ready": ReadyNotification
  "session.event": SessionEvent
  "server.warning": { code: string; skipped?: number; recovery?: string }
}

