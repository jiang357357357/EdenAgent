import { constants } from 'node:fs'
import { open, readdir, realpath, lstat } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { skillMetadata } from './metadata.ts'
import { codeManifests } from './code-manifest.ts'
import type { SkillCodeTool } from './code-manifest.ts'

export interface SkillSnapshot {
  name: string; displayName: string; description: string; version: string; content: string
  modelInvocable: boolean; tools: string[]; profiles: string[]; permissions: string[]; defaultPrompt: string
  codeTools?: SkillCodeTool[]
  files: Record<string, string>; contentHash: string; totalBytes: number
}
export async function readLocalSnapshot(source: string, subpath: string): Promise<SkillSnapshot> {
  const root = await realpath(source)
  const relative = subpath || '.'
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('Skill subpath must stay inside its source')
  const target = await realpath(path.resolve(root, relative))
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Skill subpath escapes source')
  const files: Record<string, string> = {}
  let total = 0
  async function visit(directory: string, prefix: string, depth: number): Promise<void> {
    if (depth > 12) throw new Error('Skill directory is too deep')
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['.git', 'node_modules', '.env'].includes(entry.name)) continue
      if (entry.isSymbolicLink()) throw new Error('Skill packages cannot contain symbolic links')
      const filename = path.join(directory, entry.name), key = prefix + entry.name
      if (entry.isDirectory()) { await visit(filename, key + '/', depth + 1); continue }
      if (!entry.isFile()) throw new Error('Skill packages must contain regular files')
      if (Object.keys(files).length >= 256) throw new Error('Skill package exceeds 256 files')
      const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const info = await handle.stat()
        if (!info.isFile() || info.size > 1024 * 1024 || total + info.size > 8 * 1024 * 1024) throw new Error('Skill package exceeds size limit')
        const bytes = Buffer.alloc(Number(info.size) + 1)
        const read = await handle.read(bytes, 0, bytes.length, 0)
        if (read.bytesRead !== info.size || (await lstat(filename)).isSymbolicLink()) throw new Error('Skill source changed while reading')
        total += read.bytesRead
        files[key] = bytes.subarray(0, read.bytesRead).toString('base64')
      } finally { await handle.close() }
    }
  }
  await visit(target, '', 0)
  if (!files['SKILL.md']) throw new Error('Skill root must contain SKILL.md')
  return snapshot(files, path.basename(target))
}
export function snapshot(files: Record<string, string>, fallback: string): SkillSnapshot {
  const content = Buffer.from(files['SKILL.md']!, 'base64').toString('utf8')
  if (Buffer.byteLength(content) > 262144) throw new Error('SKILL.md exceeds 256 KiB')
  const metadata = skillMetadata(content, fallback), codeTools = codeManifests(files)
  const ordered = Object.fromEntries(Object.keys(files).sort().map(key => [key, files[key]!]))
  return { ...metadata, content, codeTools, tools: [...new Set([...metadata.tools, ...codeTools.map(tool => tool.name)])],
    files: ordered, contentHash: createHash('sha256').update(JSON.stringify(ordered)).digest('hex'),
    totalBytes: Object.values(files).reduce((size, data) => size + Buffer.from(data, 'base64').length, 0) }
}
