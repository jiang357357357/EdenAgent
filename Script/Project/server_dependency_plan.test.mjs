import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { serverDependencyPlan } from './server_dependency_plan.mjs'

async function fixture(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'eden-dependency-plan-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const add = async (relative, name, version, dependencies = {}, rest = {}) => {
    const directory = path.join(root, 'node_modules', relative)
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name, version, dependencies, ...rest }))
    return directory
  }
  return { root, add }
}

test('uses workspace pinned dependencies and preserves nested version conflicts', async context => {
  const { root, add } = await fixture(context)
  await add('@eden/server', '@eden/server', '1', { ws: '8', other: '1' })
  await add('@eden/server/node_modules/ws', 'ws', '8')
  await add('ws', 'ws', '9')
  await add('other', 'other', '1', { ws: '9' })
  const plan = serverDependencyPlan(root)
  assert.equal(plan.find(item => item.relative === 'ws').version, '8')
  assert.equal(plan.find(item => item.relative === path.join('other', 'node_modules', 'ws')).version, '9')
  assert.ok(plan.every(item => !item.name.startsWith('@eden/')))
})

test('cycles terminate, missing optional packages skip, missing required packages fail', async context => {
  const { root, add } = await fixture(context)
  await add('@eden/server', '@eden/server', '1', { a: '1' })
  await add('a', 'a', '1', { b: '1' }, { optionalDependencies: { unavailable: '1' } })
  await add('b', 'b', '1', { a: '1' })
  assert.equal(serverDependencyPlan(root).length, 2)
  await add('b', 'b', '1', { required: '1' })
  assert.throws(() => serverDependencyPlan(root), /Missing runtime dependency required/)
})
