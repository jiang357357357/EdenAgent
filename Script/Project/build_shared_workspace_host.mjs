import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export async function buildSharedWorkspaceHost(root = fileURLToPath(new URL('../../', import.meta.url)), output = 'dist/server/shared-workspace-host.mjs') {
  await build({ absWorkingDir: root, entryPoints: ['packages/shared-workspace/host/main.ts'], outfile: path.resolve(root, output),
    bundle: true, platform: 'node', target: 'node22', format: 'esm', sourcemap: false, legalComments: 'none' })
  await build({ absWorkingDir: root, entryPoints: ['packages/shared-workspace/host/installer.mjs'],
    outfile: path.join(path.dirname(path.resolve(root, output)), 'shared-workspace-install.mjs'),
    bundle: true, platform: 'node', target: 'node22', format: 'esm', sourcemap: false, legalComments: 'none' })
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await buildSharedWorkspaceHost()
