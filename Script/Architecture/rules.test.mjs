import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inspectSource } from './source-rules.mjs'
import { dependencyViolations, findCycles } from './dependency-rules.mjs'

const policy = { maximumLines: 500, warningLines: 300, warningFunctionLines: 60, maximumComplexity: 15 }
test('syntax errors cannot pass architecture inspection', () => {
  assert.ok(inspectSource('Server/src/broken.ts', 'function broken() {', policy).errors.some(error => error.startsWith('syntax:')))
})
test('rejects oversized source, barrel logic, and hidden pi dependency', () => {
  assert.ok(inspectSource('Server/src/index.ts', 'export const x = 1', policy).errors.length)
  assert.ok(inspectSource('Server/src/test.ts', 'x\n'.repeat(501), policy).errors.length)
  assert.ok(dependencyViolations('Server/src/a.ts', '@earendil-works/pi-agent-core').length)
})
test('counts decisions within each function and detects import cycles', () => {
  const code = `function run(x) { ${'if(x) x++;'.repeat(15)} }`
  assert.ok(inspectSource('Server/src/run.ts', code, policy).errors.some(error => error.includes('complexity')))
  assert.equal(findCycles(new Map([['a', ['b']], ['b', ['a']]])).length, 1)
})
test('allows public business access but rejects private and reverse dependencies', () => {
  const file = 'Server/src/modules/jobs/run.ts'
  assert.deepEqual(dependencyViolations(file, '../memory/index.ts', 'Server/src/modules/memory/index.ts'), [])
  assert.ok(dependencyViolations(file, '../memory/private.ts', 'Server/src/modules/memory/private.ts').length)
  assert.ok(dependencyViolations(file, '../../bootstrap/config.ts', 'Server/src/bootstrap/config.ts').length)
})
