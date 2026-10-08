import { build } from 'esbuild'

await build({
  entryPoints: { main: 'Server/src/main.ts', 'runtime-process': 'packages/runtime-pi/src/process-entry.ts' },
  outdir: 'dist/server', outExtension: { '.js': '.mjs' }, bundle: true,
  platform: 'node', target: 'node22', format: 'esm', sourcemap: true,
  define: { EDEN_BUNDLED_SERVER: 'true' },
  banner: { js: "import { createRequire as serverCreateRequire } from 'node:module'; const require = serverCreateRequire(import.meta.url);" },
  external: ['@earendil-works/*', 'ws', 'zod', 'typebox', 'esbuild'],
})
process.stdout.write('Built dist/server/main.mjs (pi and npm runtime dependencies remain external)\n')
