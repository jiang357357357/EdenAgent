import { convertLegacySubagentContexts } from './subagent-context-conversion.ts'
import { convertLegacyContexts } from './context-conversion.ts'
import { recoverLegacyPluginFiles } from './plugin-file-recovery.ts'
import { convertLegacyPlugins } from './plugin-conversion.ts'
import { convertLegacyImportProvenance } from './import-provenance-conversion.ts'
import { convertLegacyMetrics } from './metric-conversion.ts'
import { convertLegacyAppConfig } from './app-config-conversion.ts'
import { convertLegacySubagents } from './subagent-conversion.ts'
import { convertLegacyAgentMailbox } from './subagent-mailbox-conversion.ts'
import { convertLegacyCoreSync } from './core-sync-conversion.ts'
import { convertLegacyWorkspace } from './workspace-conversion.ts'
import { convertLegacyModelSelections } from './model-selection-conversion.ts'
import { linkLegacyExecutions } from './execution-links.ts'
import { convertLegacyDesktop } from './desktop-conversion.ts'
import { convertLegacyInputs } from './input-conversion.ts'
import { convertLegacyConnectors } from './connector-conversion.ts'
import { convertLegacyMedia } from './media-conversion.ts'
import { convertLegacyVoice } from './voice-conversion.ts'
import { convertLegacyOperations } from './operation-conversion.ts'
import { conversionReport, writeConversionReport } from './conversion-report.ts'
import { convertSelfAwakeNotifications } from './self-awake-notifications.ts'
import { convertSelfAwakeHistory } from './self-awake-history.ts'
import { convertLegacyJobs } from './job-conversion.ts'
import { convertLegacyMemos } from './memo-conversion.ts'
import { convertLegacyMemories } from './memory-conversion.ts'
import { convertLegacyInteractions } from './interaction-conversion.ts'
import { convertLegacyBlobs } from './blob-conversion.ts'
import { convertLegacyEvents } from './event-conversion.ts'
import type { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import type { LegacySnapshotReader } from './snapshot-reader.ts'
import { convertLegacySession } from './session-conversion.ts'
import { tableConverted } from './conversion-state.ts'
import { preservePartialBlobs } from './partial-blobs.ts'

export async function runLegacyConversion(db: DatabaseSync, source: LegacySnapshotReader, target: string, origin: 'mon' | 'local', blobSourceRoot?: string, pluginVersionsRoot?: string) {
  let phase = 'initialize'
  const report = () => conversionReport(db, origin, phase)
  const checkpoint = () => writeConversionReport(target, report())
  try {
    phase = 'sessions'
    if (!tableConverted(db, 'sessions')) {
    db.exec('BEGIN IMMEDIATE')
    try {
      await source.scan('sessions', row => convertLegacySession(db, row, origin))
      db.prepare("UPDATE legacy_conversion_tables SET state='converted' WHERE name='sessions'").run()
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    }
    await checkpoint()
    const stages = [
      ['session_events', () => tableConverted(db, 'session_events') ? Promise.resolve() : convertLegacyEvents(db, source)],
      ['agent_threads', () => convertLegacySubagents(db, source)],
      ['agent_mailbox', () => convertLegacyAgentMailbox(db, source)],
      ['interactions', () => convertLegacyInteractions(db, source)],
      ['plugins', () => convertLegacyPlugins(db, source)],
      ['import_provenance', () => convertLegacyImportProvenance(db, source)],
      ['runtime_metrics', () => convertLegacyMetrics(db, source)],
      ['app_config', () => convertLegacyAppConfig(db, source)],
      ['workspace_state', () => convertLegacyWorkspace(db, source)],
      ['core_sync', () => convertLegacyCoreSync(db, source)],
      ['model_selections', () => convertLegacyModelSelections(db, source)],
      ['media_requests', () => convertLegacyMedia(db, source)],
      ['operation_journal', () => convertLegacyOperations(db, source)],
      ['connectors', () => convertLegacyConnectors(db, source)],
      ['memories', () => convertLegacyMemories(db, source)],
      ['memos', () => convertLegacyMemos(db, source)],
      ['jobs', () => convertLegacyJobs(db, source)],
      ['session_inputs', () => convertLegacyInputs(db, source)],
      ['self_awake_history', () => convertSelfAwakeHistory(db, source)],
      ['desktop_reminders', () => convertLegacyDesktop(db, source)],
      ['self_awake_notifications', () => convertSelfAwakeNotifications(db, source)],
    ] as const
    for (const [name, convert] of stages) {
      phase = name
      await convert()
      await checkpoint()
    }
    if (blobSourceRoot && !tableConverted(db, 'blobs')) {
      phase = 'blobs'
      await preservePartialBlobs(target)
      await convertLegacyBlobs(db, source, blobSourceRoot, path.join(target, 'blobs'))
      await checkpoint()
    }
    if (pluginVersionsRoot) {
      phase = 'plugin_files'
      await recoverLegacyPluginFiles(db, pluginVersionsRoot, target)
      await checkpoint()
    }
    phase = 'voice_speech_segments'
    await convertLegacyVoice(db, source)
    await checkpoint()
    phase = 'execution_links'
    linkLegacyExecutions(db)
    await checkpoint()
    phase = 'runtime_contexts'
    convertLegacyContexts(db)
    await checkpoint()
    phase = 'subagent_contexts'
    convertLegacySubagentContexts(db)
    await checkpoint()
    phase = 'awaiting_remaining_domains'
    await checkpoint()
    return report()
  } catch (error) {
    try { await writeConversionReport(target, conversionReport(db, origin, phase, error)) }
    catch (reportError) { throw new AggregateError([error, reportError], 'Conversion and report persistence failed') }
    throw error
  }
}
