import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const checkNames = ['legacy-workspace-recovery', 'managed-workspace-relocation', 'external-workspace-preserved', 'legacy-default-inheritance']
const hash = async filename => createHash('sha256').update(await readFile(filename)).digest('hex')

export async function artifactReport(entry, destination) {
  const worker = path.join(path.dirname(entry), 'runtime-process.mjs')
  // A failed run must never leave an earlier passed report available for publication.
  if (destination) {
    assert.notEqual(path.resolve(destination), path.resolve(entry), 'Report cannot overwrite the artifact entry')
    assert.notEqual(path.resolve(destination), path.resolve(process.execPath), 'Report cannot overwrite the Node executable')
    assert.notEqual(path.resolve(destination), path.resolve(worker), 'Report cannot overwrite the runtime process')
    await rm(destination, { force: true })
  }
  assert.equal(process.versions.node, '22.23.1', 'Use the pinned distribution Node runtime for artifact verification')
  const entrySha256 = await hash(entry), nodeSha256 = await hash(process.execPath)
  const runtimeProcessSha256 = existsSync(worker) ? await hash(worker) : undefined
  const passed = new Set()
  return {
    passed(name) {
      assert.ok(checkNames.includes(name), 'Unknown artifact relocation check')
      passed.add(name)
    },
    async finish() {
      if (!destination || !checkNames.every(name => passed.has(name))) return
      assert.equal(await hash(entry), entrySha256, 'Artifact entry changed during verification')
      assert.equal(await hash(process.execPath), nodeSha256, 'Node executable changed during verification')
      if (runtimeProcessSha256) assert.equal(await hash(worker), runtimeProcessSha256, 'Runtime process changed during verification')
      const report = { schemaVersion: 1, status: 'passed', entrySha256, nodeSha256, nodeVersion: process.versions.node,
        ...(runtimeProcessSha256 ? { runtimeProcessSha256 } : {}),
        checks: checkNames.map(name => ({ name, status: 'passed' })) }
      await mkdir(path.dirname(path.resolve(destination)), { recursive: true })
      const staging = `${destination}.tmp-${randomUUID()}`
      try {
        await writeFile(staging, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
        await rename(staging, destination)
      } finally { await rm(staging, { force: true }) }
    },
  }
}
