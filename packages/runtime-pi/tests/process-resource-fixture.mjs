import { getHeapStatistics } from 'node:v8'
let mode, pending
const memory = () => ({ ...process.memoryUsage(), heapLimit: getHeapStatistics().heap_size_limit })
const heartbeat = () => process.send({ type: 'heartbeat', memory: memory() })
setInterval(heartbeat, 100).unref()
process.on('message', message => {
  if (message.type !== 'call') return
  const reply = value => process.send({ type: 'reply', id: message.id, value })
  if (message.method === 'initialize') { mode = message.args[0].systemPrompt; heartbeat(); reply(); return }
  if (message.method === 'abort') {
    setTimeout(() => {
      if (pending) process.send({ type: 'reply', id: pending, value: { stopReason: 'aborted' } })
      reply()
    }, 2300)
    return
  }
  if (message.method !== 'prompt') return reply(memory())
  if (mode === 'slow-abort') { pending = message.id; return }
  if (mode === 'crash-output') {
    process.stdout.write('x'.repeat(256 * 1024) + 'stdout-final-marker\n', () => {
      process.stderr.write('diagnostic-fatal-marker\n', () => process.exit(134))
    })
    return
  }
  if (mode === 'heap-oom') {
    const retained = []
    while (true) retained.push(new Array(1024 * 1024).fill(retained.length + 0.25))
  }
  if (mode === 'heap-600m') {
    const retained = Array.from({ length: 10 }, (_, index) => new Array(8 * 1024 * 1024).fill(index))
    reply({ ...memory(), arrays: retained.length, execArgv: process.execArgv })
    return
  }
  reply({ ...memory(), execArgv: process.execArgv })
})
