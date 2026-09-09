import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { inspectSource } from './source-rules.mjs'
import { dependencyViolations, findCycles } from './dependency-rules.mjs'

const root = process.cwd()
const policy = JSON.parse(fs.readFileSync(new URL('./policy.json', import.meta.url), 'utf8'))
const files = []
function collect(directory) {
  if (!fs.existsSync(directory)) return
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(entry.name)) continue
    const name = path.join(directory, entry.name)
    if (entry.isDirectory()) collect(name)
    else if (entry.isFile() && /\.tsx?$/.test(name)) files.push(name.replaceAll(path.sep, '/'))
  }
}
policy.roots.forEach(collect)
const options = { moduleResolution: ts.ModuleResolutionKind.NodeNext, module: ts.ModuleKind.NodeNext, allowImportingTsExtensions: true }
const graph = new Map()
const errors = []
for (const [file, reason] of Object.entries(policy.exceptions)) {
  if (!files.includes(file) || typeof reason !== 'string' || reason.trim().length < 20) errors.push(`${file}: stale or unexplained exception`)
}
for (const file of files) {
  const result = inspectSource(file, fs.readFileSync(file, 'utf8'), policy)
  if (!policy.exceptions[file]) errors.push(...result.errors.map(error => `${file}: ${error}`))
  for (const warning of result.warnings) process.stderr.write(`WARNING ${file}: ${warning}\n`)
  const edges = []
  for (const specifier of result.imports) {
    const resolved = ts.resolveModuleName(specifier, path.resolve(file), options, ts.sys).resolvedModule
    const target = resolved ? path.relative(root, resolved.resolvedFileName).replaceAll(path.sep, '/') : undefined
    errors.push(...dependencyViolations(file, specifier, target).map(error => `${file}: ${error}`))
    if (target && files.includes(target)) edges.push(target)
  }
  graph.set(file, edges)
}
errors.push(...findCycles(graph).map(cycle => `dependency cycle: ${cycle}`))
for (const error of errors) process.stderr.write(`ERROR ${error}\n`)
process.stdout.write(`Architecture: ${files.length} source files, ${errors.length} errors\n`)
process.exitCode = errors.length ? 1 : 0
