import { fork } from 'node:child_process'
import { watchRuntimeParent } from '../src/process-parent-watch.ts'

if (process.argv[2] === 'child') {
  watchRuntimeParent()
  process.send?.({ ready: true, pid: process.pid })
  setTimeout(() => { while (true) { /* Block the main event loop after the monitor starts. */ } }, 200)
} else {
  const child = fork(new URL(import.meta.url), ['child'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  child.on('message', message => process.send?.(message))
}
