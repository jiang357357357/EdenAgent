import { build } from 'esbuild'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const commands = {
  'export-legacy': 'export_legacy.mjs',
  'import-legacy': 'import_legacy.mjs',
  'activate-legacy': 'activate_legacy.mjs',
  'activate-pair': 'activate_pair.mjs',
  'rollback-pair': 'rollback_pair.mjs',
  'select-runtime': 'select_runtime.mjs',
}

export async function buildMigrationTools(root) {
  await build({
    entryPoints: Object.fromEntries(Object.entries(commands).map(([name, script]) => [name, path.join(root, 'Script/Project', script)])),
    outdir: path.join(root, 'dist/migration'), outExtension: { '.js': '.mjs' },
    bundle: true, platform: 'node', target: 'node22', format: 'esm', sourcemap: true,
    external: ['zod'],
    banner: { js: "import { createRequire as migrationCreateRequire } from 'node:module'; const require = migrationCreateRequire(import.meta.url);" },
  })
}

export async function copyMigrationTools(root, output) {
  const directory = path.join(output, 'migration')
  await mkdir(directory)
  const artifacts = []
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
  for (const name of Object.keys(commands)) {
    for (const suffix of ['.mjs', '.mjs.map']) {
      const filename = `${name}${suffix}`, source = path.join(root, 'dist/migration', filename)
      const bytes = await readFile(source)
      await cp(source, path.join(directory, filename))
      artifacts.push({ file: `migration/${filename}`, bytes: bytes.length, sha256: sha256(bytes) })
    }
  }
  const roleExporter = await readFile(path.join(root, 'Script/Project/export_legacy_roles.py'))
  await writeFile(path.join(directory, 'export-legacy-roles.py'), roleExporter, { mode: 0o600 })
  artifacts.push({ file: 'migration/export-legacy-roles.py', bytes: roleExporter.length, sha256: sha256(roleExporter) })
  const instructions = `# Eden offline migration tools

Run with the Node executable included in this distribution (Node 22.23.1).
From the distribution root on Linux/macOS: ./node/node migration/<command>.mjs <arguments>
On Windows: .\\node\\node.exe migration\\<command>.mjs <arguments>
No tsx, checkout, npm install, or Rust host is required for these bundled JavaScript tools.
The optional export-legacy-roles.py helper requires Python 3.11+ and is not run automatically.

Commands:
- export-legacy.mjs <legacy.sqlite> <new-snapshot-directory> <mon|local>
- import-legacy.mjs stage|resume|status|review-context|apply-context-summary|plan-activation ...
- activate-legacy.mjs activate <snapshot> <staging-directory> <mon|local> <confirmation.json>
- activate-legacy.mjs rollback <staging-directory> <mon|local> <activation-id> <note> --confirm-rollback
- activate-pair.mjs <group.json> <request.json> --confirm-joint-activation
- rollback-pair.mjs <group.json> <group-id> <note> --confirm-joint-rollback
- select-runtime.mjs read|select|restore ...

CLI usage errors may show source-tree command names; keep arguments and use the bundled filenames above.
Stop the relevant launchers and hosts before changing activation or runtime selection.
Review-mode servers must also be stopped before offline operations.
All source snapshots and pre-activation databases are retained. Rollback does not undo external effects.
Both roots, group records, selection records and their history must retain their absolute paths.
Set EDEN_AGENT_RUNTIME_SELECTION for the desktop launcher after selecting both roots.
Direct main.mjs startup instead requires the selected single-world data root and origin.
Do not bypass blocked/incomplete states by editing database metadata.
See data-migration.md for confirmation schemas, recovery steps and remaining implementation limits.
`
  await writeFile(path.join(directory, 'README.md'), instructions)
  const guide = await readFile(path.join(root, '文档/技术/ts-migration/数据迁移操作.md'))
  await writeFile(path.join(directory, 'data-migration.md'), guide)
  for (const filename of ['README.md', 'data-migration.md']) {
    const bytes = await readFile(path.join(directory, filename))
    artifacts.push({ file: `migration/${filename}`, bytes: bytes.length, sha256: sha256(bytes) })
  }
  return { format: 1, node: '22.23.1', commands: Object.keys(commands), artifacts,
    optionalRoleExporter: { file: 'migration/export-legacy-roles.py', requires: 'Python 3.11+' } }
}
