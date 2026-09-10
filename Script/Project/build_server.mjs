import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { buildMigrationTools } from './migration_artifacts.mjs'

await build({
  entryPoints: ['Server/src/main.ts'], outfile: 'dist/server/main.mjs', bundle: true,
  platform: 'node', target: 'node22', format: 'esm', sourcemap: true,
  define: { EDEN_BUNDLED_SERVER: 'true' },
  banner: { js: "import { createRequire as serverCreateRequire } from 'node:module'; const require = serverCreateRequire(import.meta.url);" },
  external: ['@earendil-works/*', 'ws', 'zod', 'typebox', 'esbuild'],
})
process.stdout.write('Built dist/server/main.mjs (pi and npm runtime dependencies remain external)\n')
await buildMigrationTools(fileURLToPath(new URL('../../', import.meta.url)))
process.stdout.write('Built standalone offline migration tools in dist/migration\n')
