import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { buildDesktopObserver } from './build_desktop_observer.mjs'
import { copyVideoSources } from './video_resources.mjs'
import { copyFile } from 'node:fs/promises'
import { buildSharedWorkspaceHost } from './build_shared_workspace_host.mjs'

function buildOptions(root, outdir) {
  return { absWorkingDir: root, outdir, outExtension: { '.js': '.mjs' }, bundle: true,
    platform: 'node', target: 'node22', format: 'esm', sourcemap: true,
    define: { EDEN_BUNDLED_SERVER: 'true' },
    banner: { js: "import { createRequire as serverCreateRequire } from 'node:module'; const require = serverCreateRequire(import.meta.url);" } }
}

export function buildRuntimeWorker(root, outdir = 'dist/server') {
  return build({ ...buildOptions(root, outdir), entryPoints: { 'runtime-process': 'packages/runtime-pi/src/process-entry.ts' },
    external: ['ws', 'esbuild'] })
}

export async function buildServer(root = fileURLToPath(new URL('../../', import.meta.url)), output = 'dist/server') {
  const directory = path.resolve(root, output)
  const common = buildOptions(root, directory)
  await copyVideoSources(root, directory)
  await buildDesktopObserver(root, directory)
  await copyFile(path.join(root, 'Server/src/modules/desktop/cua-driver.LICENSE'), path.join(directory, 'cua-driver.LICENSE'))
  // Workers are created per turn; bundle the public SDK graph to avoid resolving many separate modules again.
  await Promise.all([
    build({ ...common, entryPoints: { main: 'Server/src/main.ts',
      'workspace-search-worker': 'Server/src/modules/workspace/workspace-search-worker.ts',
      'desktop-broker': 'Server/src/modules/desktop/broker-entry.ts', 'cua-worker': 'Server/src/modules/desktop/cua-worker.ts' },
      external: ['@earendil-works/*', '@trycua/*', 'koffi', 'ajv', 'ws', 'zod', 'typebox', 'esbuild', 'playwright-core', 'onnxruntime-node', 'onnx-proto', '@huggingface/tokenizers', 'ssh2'] }),
    buildRuntimeWorker(root, directory),
    buildSharedWorkspaceHost(root, path.join(directory, 'shared-workspace-host.mjs')),
  ])
  process.stdout.write('Built Server and bundled isolated runtime worker\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length > 3) throw new Error('Usage: node build_server.mjs [output-directory]')
  await buildServer(undefined, process.argv[2])
}
