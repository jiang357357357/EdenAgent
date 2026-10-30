import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { verifyRuntimeAssets } from './shared_host_runtime_assets.mjs'

const workspace = fileURLToPath(new URL('../../../', import.meta.url))
const source = path.join(workspace, 'DLC/SharedWorkspace'), output = process.argv[2] && path.resolve(process.argv[2])
if (!output || process.argv.length !== 3) throw new Error('Usage: node package_shared_workspace_dlc.mjs <new-output-directory>')
try { await stat(output); throw new Error('Refusing to replace an existing DLC directory') } catch (error) { if (error.code !== 'ENOENT') throw error }
const manifest = JSON.parse(await readFile(path.join(source, 'Runtime/manifest.json'), 'utf8'))
await verifyRuntimeAssets(path.join(source, 'Runtime'), manifest)
await mkdir(output, { recursive: true })
for (const name of ['dlc-manifest.json', '.monworkspace', 'monpm.json', 'README.md', 'Runtime', 'docs/cloud-host.md'])
  await cp(path.join(source, name), path.join(output, name), { recursive: true })
await verifyRuntimeAssets(path.join(output, 'Runtime'), manifest)
await writeFile(path.join(output, 'CLOUD-RUNTIME-INFO.json'), JSON.stringify(manifest, null, 2) + '\n')
process.stdout.write('Assembled complete SharedWorkspace DLC with verified cloud runtimes\n')
