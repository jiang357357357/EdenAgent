import { spawn } from 'node:child_process'
import path from 'node:path'

import { discoverTestFiles } from './discover_tests.mjs'

const roots = process.argv.slice(2)
const tests = await discoverTestFiles(roots)
if (tests.length === 0) {
  throw new Error(`No test files found below: ${roots.join(', ')}`)
}

const relativeTests = tests.map(file => path.relative(process.cwd(), file))
console.log(`[test-discovery] ${relativeTests.length} test files`)
for (const root of roots) {
  const absoluteRoot = path.resolve(root)
  const count = tests.filter(file => file === absoluteRoot || file.startsWith(`${absoluteRoot}${path.sep}`)).length
  console.log(`[test-discovery] ${root}: ${count}`)
}

const child = spawn(process.execPath, ['--import', 'tsx', '--test', ...relativeTests], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
})

child.once('error', error => {
  console.error(error)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  if (signal) {
    console.error(`[test-discovery] test process stopped by ${signal}`)
    process.exitCode = 1
    return
  }
  process.exitCode = code ?? 1
})

