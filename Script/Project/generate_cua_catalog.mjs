import { CuaDriver } from '@trycua/cua-driver'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createHash } from 'node:crypto'

const root = fileURLToPath(new URL('../../', import.meta.url))
const target = path.join(root, 'Server/src/modules/desktop/cua-catalog.json')
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const driver = CuaDriver.create(undefined)
try {
  const native = JSON.parse(await driver.listToolsJson())
  const catalog = { version: '0.28.0', tools: native.tools }
  if (process.argv.includes('--write')) {
    await writeFile(target, JSON.stringify(catalog, null, 2) + '\n')
    const names = native.tools.map(tool => tool.name).sort()
    await writeFile(path.join(root, 'packages/api/src/cua-tools.ts'),
      '/** Public tool names from the pinned Cua Driver 0.28.0 catalog. */\nexport const cuaToolNames = ' + JSON.stringify(names, null, 2) + ' as const\n')
  } else {
    const recorded = JSON.parse(await readFile(target, 'utf8'))
    if (JSON.stringify(canonical(recorded)) !== JSON.stringify(canonical(catalog))) throw new Error('Pinned Cua catalog differs from the installed native runtime; regenerate and review the diff')
  }
  process.stdout.write(JSON.stringify({ version: catalog.version, tools: native.tools.length,
    sha256: createHash('sha256').update(JSON.stringify(canonical(catalog))).digest('hex'), nativeInputPerformed: false }) + '\n')
} finally { await driver.shutdown(); driver.uniffiDestroy() }
