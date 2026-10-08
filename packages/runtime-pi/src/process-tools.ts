import { adaptTool } from './tool-adapter.ts'
import type { RuntimeOptions, RuntimeTool } from './contracts.ts'
import type { ToolDescription } from './process-protocol.ts'

/** Tool closures and their authority remain in the authenticated host context. */
export class ProcessTools {
  private nextHandle = 0
  private readonly handles = new Map<number, RuntimeTool>()
  constructor(private readonly options: RuntimeOptions, private readonly signal: AbortSignal,
    private readonly healthy: () => void, private readonly fail: (error: unknown) => never) {}

  describe(tools: RuntimeTool[]): ToolDescription[] {
    this.handles.clear()
    return tools.map(tool => {
      const handle = ++this.nextHandle
      this.handles.set(handle, tool)
      return { handle, name: tool.name, description: tool.description, revision: tool.revision, parameters: tool.parameters,
        ...(tool.executionMode ? { executionMode: tool.executionMode } : {}), ...(tool.promptHint ? { promptHint: tool.promptHint } : {}) }
    })
  }

  async execute(handle: number, callId: string, input: unknown): Promise<unknown> {
    this.healthy()
    this.signal.throwIfAborted()
    const tool = this.handles.get(handle)
    if (!tool) throw new Error('Runtime tool definition expired')
    const guarded = { ...this.options.callbacks,
      beforeTool: async (...args: Parameters<NonNullable<RuntimeOptions['callbacks']['beforeTool']>>) => {
        this.healthy(); this.signal.throwIfAborted(); await this.options.callbacks.beforeTool?.(...args)
      },
      afterTool: async (...args: Parameters<NonNullable<RuntimeOptions['callbacks']['afterTool']>>) => {
        this.healthy(); await this.options.callbacks.afterTool?.(...args)
      },
    }
    return adaptTool(tool, guarded, this.healthy, this.fail, this.options.toolCallPrefix).execute(callId, input, this.signal, undefined, undefined)
  }
}
