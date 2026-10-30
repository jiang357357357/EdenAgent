import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { processSourceIdentity, hostGoCompiler, buildHostMonpm, hostGoNotices } from './shared_host_go_build.mjs'
import { downloadRuntime, compressRuntime, verifyRuntimeAssets } from './shared_host_runtime_assets.mjs'
import { prepareCppRuntime } from './shared_host_cpp_runtime.mjs'

const execute = promisify(execFile)
const agentRoot = fileURLToPath(new URL('../../', import.meta.url)), workspace = path.dirname(agentRoot)
export const cloudNodeVersion = '22.23.1'
export async function buildSharedHostRuntimes(output = path.join(workspace, 'DLC/SharedWorkspace/Runtime')) {
  const processRoot = path.join(workspace, 'Process'), identity = await processSourceIdentity(processRoot)
  const compiler = await hostGoCompiler()
  const componentVersion = (await readFile(path.join(workspace, 'VERSION'), 'utf8')).trim()
  if (!/^\d+\.\d+\.\d+$/.test(componentVersion)) throw new Error('Invalid Mon component version')
  try {
    const existing = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'))
    if (existing.schemaVersion === 2 && existing.nodeVersion === cloudNodeVersion && existing.monpm.sourceHash === identity.sourceHash
      && existing.monpm.sourceCommit === identity.sourceCommit && existing.monpm.compiler === compiler.version
      && /^\d+\.\d+\.\d+$/.test(existing.monpm.componentVersion ?? '')) {
      await verifyRuntimeAssets(output, existing)
      process.stdout.write('Reused verified x64 / ARM64 cloud runtimes\n'); return existing
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const cache = path.join(workspace, '.run/shared-host-runtime-cache')
  await mkdir(cache, { recursive: true }); await mkdir(output, { recursive: true })
  const checksumUrl = `https://nodejs.org/dist/v${cloudNodeVersion}/SHASUMS256.txt`
  const response = await fetch(checksumUrl, { redirect: 'error', signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error('Unable to obtain official Node checksums')
  const checksums = await response.text()
  const targets = {}, staging = await mkdtemp(path.join(cache, 'build-'))
  try {
    for (const architecture of ['x64', 'arm64']) {
      process.stdout.write(`Preparing Linux ${architecture} runtimes\n`)
      const archiveName = `node-v${cloudNodeVersion}-linux-${architecture}.tar.gz`
      const expected = checksums.split('\n').map(line => line.trim().split(/\s+/)).find(row => row[1] === archiveName)?.[0]
      if (!/^[a-f0-9]{64}$/.test(expected ?? '')) throw new Error('Official Node checksum is missing')
      const archive = path.join(cache, archiveName), extract = path.join(staging, architecture)
      await downloadRuntime(`https://nodejs.org/dist/v${cloudNodeVersion}/${archiveName}`, archive, expected)
      await mkdir(extract)
      await execute('tar', ['-xzf', archive, '-C', extract, '--strip-components=1',
        `node-v${cloudNodeVersion}-linux-${architecture}/bin/node`, `node-v${cloudNodeVersion}-linux-${architecture}/LICENSE`], { windowsHide: true })
      await buildHostMonpm(compiler, processRoot, path.join(extract, 'monpm'), architecture, { ...identity, componentVersion })
      const cpp = await prepareCppRuntime(cache, extract, architecture)
      const entry = {}
      for (const name of ['node', 'monpm', 'libstdcpp', 'libgcc']) {
        const file = `${name}-linux-${architecture}.gz`, source = path.join(extract, name === 'node' ? 'bin/node' : name)
        entry[name] = await compressRuntime(source, path.join(output, file), file)
      }
      targets[`linux-${architecture}`] = entry
      entry.cppSources = cpp.sources
      if (architecture === 'x64') await writeFile(path.join(output, 'LICENSE.node.txt'), await readFile(path.join(extract, 'LICENSE')))
      if (architecture === 'x64') await writeFile(path.join(output, 'NOTICE.cpp.txt'), cpp.notice)
    }
    await writeFile(path.join(output, 'NOTICE.monpm.txt'), await hostGoNotices(compiler))
    const finalIdentity = await processSourceIdentity(processRoot)
    if (finalIdentity.sourceCommit !== identity.sourceCommit || finalIdentity.sourceHash !== identity.sourceHash) throw new Error('MonPM source changed during compilation')
    const manifest = { schemaVersion: 2, nodeVersion: cloudNodeVersion, monpm: { ...identity, componentVersion, compiler: compiler.version }, targets }
    await verifyRuntimeAssets(output, manifest)
    await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    process.stdout.write('Prepared verified Node.js and MonPM for Linux x64 / ARM64\n'); return manifest
  } finally { await rm(staging, { recursive: true, force: true }) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length > 3) throw new Error('Usage: node build_shared_host_runtimes.mjs [output-directory]')
  await buildSharedHostRuntimes(process.argv[2] ? path.resolve(process.argv[2]) : undefined)
}
