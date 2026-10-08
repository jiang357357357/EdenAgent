import { Type } from 'typebox'
import { createRuntime } from './harness-runtime.ts'
import { completeText } from './text-completion.ts'
import { watchRuntimeParent } from './process-parent-watch.ts'
import { ProcessPeer } from './process-protocol.ts'
import type { ProcessMessage, ProcessOptions, ToolDescription } from './process-protocol.ts'
import type { EdenRuntime, RuntimeCallbacks, RuntimeTool } from './contracts.ts'

if (!process.send) throw new Error('Runtime process requires a private IPC channel')
watchRuntimeParent()
const send = (message: ProcessMessage) => process.send!(message, error => { if (error) process.exit(1) })
let runtime: EdenRuntime | undefined
let configuration: ProcessOptions | undefined
const textController = new AbortController()
const descriptions = (tools: ToolDescription[]): RuntimeTool[] => tools.map(tool => ({ ...tool,
  execute: async () => { throw new Error('Tool execution must use the host bridge') },
}))
const callbacks: RuntimeCallbacks = {
  checkpoint: snapshot => peer.call('checkpoint', snapshot), event: (kind, payload) => peer.call('event', kind, payload),
  request: snapshot => peer.call('request', snapshot), response: snapshot => peer.call('response', snapshot),
}
const peer = new ProcessPeer(send, async (method, args) => {
  if (method === 'initialize') {
    if (runtime) throw new Error('Runtime process is already initialized')
    const options = args[0] as ProcessOptions
    configuration = options
    runtime = createRuntime({ ...options, tools: descriptions(options.tools), callbacks,
      ...(options.refresh ? { refreshTools: async () => descriptions(await peer.call<ToolDescription[]>('refreshTools')) } : {}),
    }, (tool, internal, healthy, fail) => ({
      name: tool.name, label: tool.name, description: tool.description, parameters: Type.Unsafe(tool.parameters),
      executionMode: tool.executionMode ?? 'sequential',
      async execute(callId, input, signal) {
        healthy(); signal?.throwIfAborted()
        // Mark execution before crossing IPC, preventing model retry from replaying a side effect.
        // The host records the actual resolved tool identity and validated arguments.
        await internal.beforeTool?.(tool.name, callId, tool.revision, input as Record<string, unknown>)
        try { return await peer.call('executeTool', (tool as RuntimeTool & ToolDescription).handle, callId, input) }
        catch (error) { if (error && typeof error === 'object' && 'fatal' in error && error.fatal) fail(error); throw error }
      },
    }))
    return
  }
  if (!runtime) throw new Error('Runtime process is not initialized')
  switch (method) {
    case 'prompt': return runtime.prompt(args[0] as string, args[1] as Parameters<EdenRuntime['prompt']>[1])
    case 'steer': return runtime.steer(args[0] as string, args[1] as Parameters<EdenRuntime['steer']>[1])
    case 'followUp': return runtime.followUp(args[0] as string, args[1] as Parameters<EdenRuntime['followUp']>[1])
    case 'compact': return runtime.compact(args[0] as string | undefined)
    case 'abort': textController.abort(); return runtime.abort()
    case 'completeText': return completeText({ model: configuration!.model, systemPrompt: configuration!.systemPrompt,
      text: args[0] as string, signal: textController.signal, record: callbacks.request })
    case 'waitForIdle': return runtime.waitForIdle()
    case 'snapshot': return runtime.snapshot()
    case 'replaceTools': return runtime.replaceTools(descriptions(args[0] as ToolDescription[]))
    default: throw new Error(`Unknown runtime operation: ${method}`)
  }
})
process.on('message', message => peer.receive(message as ProcessMessage))
process.on('disconnect', () => process.exit(0))
setInterval(() => send({ type: 'heartbeat' }), 1_000).unref()
send({ type: 'heartbeat' })
