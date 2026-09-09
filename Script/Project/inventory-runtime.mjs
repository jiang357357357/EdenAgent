import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const sourcePath = 'frontend/web/src/generated/eden-agent-rpc.ts'
const source = ts.createSourceFile(sourcePath, fs.readFileSync(sourcePath, 'utf8'), ts.ScriptTarget.Latest, true)
const methodMap = source.statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === 'RpcMethodMap')
if (!methodMap) throw new Error('RPC method map not found')
const methods = methodMap.members.map(member => ({
  method: ts.isStringLiteral(member.name) ? member.name.text : member.name.getText(source),
  contract: member.type.getText(source),
}))
const archive = 'Archive/2026-09-09-rust-runtime/Server'
const migrationRoot = path.join(archive, 'crates/eden-agent-store/migrations')
const tables = new Set()
for (const filename of fs.readdirSync(migrationRoot).sort()) {
  const sql = fs.readFileSync(path.join(migrationRoot, filename), 'utf8')
  for (const match of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z_0-9]*)/gi)) tables.add(match[1])
}
const output = {
  schemaVersion: 1,
  source: sourcePath,
  archivedServerCommit: 'e6c1946f72256af28268dac64698f5282e54ce17',
  note: 'Inventory of legacy public RPC contracts and SQL tables; does not mark implementation completion.',
  methods,
  tables: [...tables].sort(),
}
const destination = '文档/技术/ts-migration/legacy-inventory.json'
fs.mkdirSync(path.dirname(destination), { recursive: true })
const content = JSON.stringify(output, null, 2) + '\n'
if (process.argv.includes('--check')) {
  if (fs.readFileSync(destination, 'utf8') !== content) throw new Error('Legacy inventory differs from source')
} else fs.writeFileSync(destination, content)
process.stdout.write(`Legacy inventory: ${methods.length} RPC methods, ${tables.size} SQL tables\n`)
