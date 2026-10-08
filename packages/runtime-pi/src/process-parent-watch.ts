import { Worker } from 'node:worker_threads'

/** This monitor has its own event loop so a stalled model cannot outlive a dead host. */
export function watchRuntimeParent(): void {
  const monitor = new Worker(`
    const { workerData } = require('node:worker_threads')
    setInterval(() => {
      try { process.kill(workerData.parentPid, 0) }
      catch (error) { if (error.code === 'ESRCH') process.kill(process.pid) }
    }, 1000)
  `, { eval: true, execArgv: [], workerData: { parentPid: process.ppid }, resourceLimits: { maxOldGenerationSizeMb: 16 } })
  monitor.on('error', () => process.exit(1))
  monitor.unref()
}
