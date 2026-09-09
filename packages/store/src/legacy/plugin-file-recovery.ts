import type { DatabaseSync } from 'node:sqlite'
import { realpath, mkdir, lstat, mkdtemp, open } from 'node:fs/promises'
import path from 'node:path'
import { legacyRow } from './snapshot-format.ts'
import { legacyText } from './fields.ts'
import { copyLegacyPluginTree, legacyPluginSource } from './plugin-file-tree.ts'

export async function recoverLegacyPluginFiles(db: DatabaseSync, versionsRoot: string, target: string): Promise<void> {
  const sourceRoot = await realpath(versionsRoot), targetRoot = await realpath(target)
  if (sourceRoot === targetRoot || sourceRoot.startsWith(targetRoot + path.sep) || targetRoot.startsWith(sourceRoot + path.sep)) throw new Error('Plugin source and conversion target must be separate')
  const destination = path.join(targetRoot, 'recovered-plugins')
  await mkdir(destination, { recursive: true, mode: 0o700 })
  const info = await lstat(destination)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Plugin recovery destination must be a private directory')
  while (true) {
    const records = db.prepare("SELECT source_id,row_json FROM legacy_plugin_history WHERE domain='plugin_versions' AND state='files_required' ORDER BY source_id LIMIT 32").all()
    if (!records.length) break
    for (const record of records) {
      const row = legacyRow(JSON.parse(String(record.row_json)))
      const id = legacyText(row, 'plugin_id'), version = legacyText(row, 'version'), revision = legacyText(row, 'revision')
      if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error('Invalid historical plugin revision')
      const source = await legacyPluginSource(sourceRoot, [id, version, revision])
      // Unique attempts preserve partial copies after a crash; never overwrite evidence in place.
      const attempt = await mkdtemp(path.join(destination, 'copy-')), filesPath = path.join(attempt, 'files')
      const manifest = await copyLegacyPluginTree(source, filesPath)
      const receipt = await open(path.join(attempt, 'recovery.json'), 'wx', 0o600)
      try {
        await receipt.writeFile(JSON.stringify({ pluginId: id, version, historicalRevision: revision, ...manifest, state: 'review_required' }, null, 2) + '\n')
        await receipt.sync()
      } finally { await receipt.close() }
      if (process.platform !== 'win32') for (const directory of [attempt, destination]) {
        const handle = await open(directory, 'r'); try { await handle.sync() } finally { await handle.close() }
      }
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare('INSERT INTO legacy_plugin_file_copies VALUES(?,?,?,?,?,?)').run(String(record.source_id), id, revision,
          path.relative(targetRoot, filesPath), JSON.stringify(manifest), Date.now())
        db.prepare("UPDATE legacy_plugin_history SET state='files_copied_review_required' WHERE domain='plugin_versions' AND source_id=? AND state='files_required'").run(record.source_id!)
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
    }
  }
}
