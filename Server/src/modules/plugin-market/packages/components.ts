import { z } from 'zod'
import { createSkillSnapshot } from '../../skills/index.ts'
import type { VerifiedPackage } from './verified-package.ts'
type Package = VerifiedPackage
const cardSchema = z.object({
  schemaVersion: z.literal(1), cards: z.array(z.object({
    id: z.string().min(1).max(128),
    location: z.enum(['plugin_detail', 'settings']), title: z.string().max(256), body: z.string().max(16000), tone: z.enum(['info', 'success', 'warning']).default('info')
  }).strict()).max(64).default([])
}).strict()
export function packageUiCards(value: Package, enabled: (id: string, fallback: boolean) => boolean) {
  return value.manifest.components.ui.filter(component => enabled(component.id, component.enabledByDefault)).flatMap(component => {
    const bytes = value.files.get(component.entry)
    if (!bytes || bytes.length > 1024 * 1024) throw new Error('UI contribution document is absent or too large')
    const document = cardSchema.parse(JSON.parse(bytes.toString('utf8'))), ids = new Set<string>()
    return document.cards.map(card => {
      if (ids.has(card.id)) throw new Error('Duplicate UI contribution ID')
      ids.add(card.id)
      return { ...card, componentId: component.id }
    })
  })
}
export function packageSkillSnapshots(value: Package, enabled: (id: string, fallback: boolean) => boolean) {
  return value.manifest.components.skills.filter(component => enabled(component.id, component.enabledByDefault)).map(component => {
    const prefix = component.path + '/', files = Object.fromEntries([...value.files].filter(([name]) => name.startsWith(prefix)).map(([name, bytes]) => [name.slice(prefix.length), bytes.toString('base64')]))
    if (Object.keys(files).length > 256 || Object.values(files).reduce((sum, bytes) => sum + Buffer.from(bytes, 'base64').length, 0) > 8 * 1024 * 1024) throw new Error('Plugin skill component exceeds skill size limit')
    return { pluginId: value.manifest.id, revision: value.revision, componentId: component.id, snapshot: createSkillSnapshot(files, component.id) }
  })
}
