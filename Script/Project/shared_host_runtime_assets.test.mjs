import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { compressRuntime, verifyRuntimeAssets } from './shared_host_runtime_assets.mjs'

async function fixture(run, override) {
  const root = await mkdtemp(path.join(tmpdir(), 'eden-runtime-elf-'))
  try {
    const manifest = { targets: {} }
    for (const architecture of ['x64', 'arm64']) {
      const target = manifest.targets[`linux-${architecture}`] = {}
      for (const name of ['node', 'monpm', 'libstdcpp', 'libgcc']) {
        const header = Buffer.alloc(80)
        header.write('7f454c46', 0, 'hex'); header[4] = 2; header[5] = 1
        header.writeUInt16LE(name.startsWith('lib') ? 3 : 2, 16)
        header.writeUInt16LE(architecture === 'x64' ? 62 : 183, 18)
        override?.(header, architecture, name)
        const source = path.join(root, 'raw'), file = `${name}-linux-${architecture}.gz`
        await writeFile(source, header)
        target[name] = await compressRuntime(source, path.join(root, file), file)
      }
    }
    for (const file of ['LICENSE.node.txt', 'NOTICE.monpm.txt', 'NOTICE.cpp.txt']) await writeFile(path.join(root, file), 'notice')
    await run(root, manifest)
  } finally { await rm(root, { recursive: true, force: true }) }
}
test('runtime builder validates paired x64 and ARM64 executables and shared libraries', async () => {
  await fixture((root, manifest) => verifyRuntimeAssets(root, manifest))
})
test('a checksum-valid executable accidentally packaged as the C++ library is rejected', async () => {
  await fixture((root, manifest) => assert.rejects(verifyRuntimeAssets(root, manifest), /libstdcpp ELF/),
    (header, _architecture, name) => { if (name === 'libstdcpp') header.writeUInt16LE(2, 16) })
})
test('a checksum-valid binary for the wrong CPU architecture is rejected', async () => {
  await fixture((root, manifest) => assert.rejects(verifyRuntimeAssets(root, manifest), /arm64/),
    (header, architecture) => { if (architecture === 'arm64') header.writeUInt16LE(62, 18) })
})
