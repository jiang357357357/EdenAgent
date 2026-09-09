import type { DatabaseSync } from 'node:sqlite'
import type { LegacySnapshotReader } from './snapshot-reader.ts'
import { tableConverted } from './conversion-state.ts'
import { legacyText, legacyUuid, legacyTime, legacyJson, preserveLegacyRow } from './fields.ts'

/** Retain Core entity selections privately; old runtime metadata is not a runnable pi model. */
export async function convertLegacyModelSelections(db: DatabaseSync, source: LegacySnapshotReader): Promise<string[]> {
  const converted: string[] = []
  for (const name of ['session_model_bindings', 'session_actor_model_bindings']) {
    if (!source.manifest.tables.some(table => table.name === name)) continue
    if (tableConverted(db, name)) { converted.push(name); continue }
    db.exec('BEGIN IMMEDIATE')
    try {
      await source.scan(name, row => {
        const session = legacyUuid(row, 'session_id'), assistant = legacyText(row, 'assistant_id')
        const entity = legacyText(row, 'ai_entity_id'), vision = row.vision_ai_entity_id === null ? null : legacyText(row, 'vision_ai_entity_id')
        if (!entity || (name === 'session_actor_model_bindings' && !assistant)) throw new Error('Invalid legacy model selection identity')
        const id = name === 'session_model_bindings' ? session : JSON.stringify([session, assistant])
        db.prepare(`INSERT INTO legacy_model_selections(domain,source_id,session_id,assistant_id,ai_entity_id,vision_ai_entity_id,
          runtime_info_json,state,updated_at) VALUES(?,?,?,?,?,?,?,'refresh_required',?)`).run(name, id, session, assistant, entity, vision,
            legacyJson(row, 'runtime_info_json'), legacyTime(row.updated_at))
        db.prepare('INSERT INTO legacy_conversion_ids VALUES(?,?,?)').run(name, id, id)
        db.prepare('INSERT INTO legacy_conversion_records VALUES(?,?,?)').run(name, id, preserveLegacyRow(row))
      })
      db.prepare("UPDATE legacy_conversion_tables SET state='converted' WHERE name=?").run(name)
      db.exec('COMMIT'); converted.push(name)
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
  return converted
}
