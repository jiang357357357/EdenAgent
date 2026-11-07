// node --import tsx Script/Test/check_runtime_artifact.mjs <current-output/runtime-process.mjs>
import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createIsolatedRuntime } from '@eden/runtime-pi'
import { recordedModel, callbacks } from '@eden/runtime-pi/testing'

if (process.argv.length !== 3) throw new Error('Expected the current runtime-process.mjs artifact path')
const entry = pathToFileURL(path.resolve(process.argv[2]))
await access(entry)
const model = await recordedModel([{ text: '打包运行时诊断验证通过' }])
const records = [], captured = callbacks()
const runtime = createIsolatedRuntime({ sessionId: randomUUID(), systemPrompt: '只回答固定的测试文本。', model: model.config,
  tools: [], callbacks: { ...captured.handlers, diagnostic: record => records.push(record) } }, { entry })
try {
  await runtime.prompt('验证当前制品')
  assert.equal(model.requests.length, 1)
  assert.ok((await runtime.snapshot()).entries.length > 0)
  await runtime.dispose()
  assert.equal(records.find(record => record.event === 'runtime.process.started')?.maxOldSpaceMb, 2048)
  assert.ok(records.find(record => record.event === 'runtime.process.disposed')?.memory?.heapLimit > 0)
  assert.equal(records.some(record => record.event === 'runtime.process.failed'), false)
  process.stdout.write(JSON.stringify({ passed: true, actualBundledWorker: true, heapBudgetMb: 2048, checkpoint: true, memoryDiagnostic: true }) + '\n')
} finally { await runtime.dispose(); await model.close() }
