import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { z } from 'zod'
import { DesktopError } from './contracts.ts'
import { computerUseError } from '../../model-prompts/computer-use.ts'

declare const EDEN_BUNDLED_SERVER: boolean
const envelope = z.object({ id: z.string().optional(), ready: z.boolean().optional(), backend: z.string().optional(), result: z.unknown().optional(),
  error: z.union([z.string(), z.object({ code: z.string().regex(/^[A-Z_]+$/) })]).optional() }).strict()
function executable() {
  const directory = fileURLToPath(new URL(typeof EDEN_BUNDLED_SERVER !== 'undefined' ? './' : '../../../../dist/server/', import.meta.url))
  const manifest = z.object({ filename: z.string().regex(/^desktop-computer-use-[a-f0-9]{16}\.exe$/) }).strict()
    .parse(JSON.parse(readFileSync(path.join(directory, 'desktop-computer-use.json'), 'utf8')))
  return path.join(directory, manifest.filename)
}
interface Pending { resolve(value: unknown): void; reject(error: Error): void; input: boolean }
export class ComputerUseTransport {
  private child: ChildProcessWithoutNullStreams | undefined
  private starting: Promise<number> | undefined
  private generation = 0
  private closed = false
  private readonly pending = new Map<string, Pending>()
  constructor(private readonly launch = () => spawn(executable(), [], { windowsHide: true, stdio: 'pipe' })) {}
  async prepare(signal: AbortSignal): Promise<number> {
    signal.throwIfAborted()
    if (this.closed) throw new DesktopError('Computer Use 已关闭', 'COMPUTER_USE_CLOSED')
    if (this.child && !this.starting) return this.generation
    this.starting ??= this.start().finally(() => { this.starting = undefined })
    const generation = await this.starting; signal.throwIfAborted(); return generation
  }
  private start(): Promise<number> {
    const child = this.launch(); this.child = child
    return new Promise((resolve, reject) => {
      let ready = false, remainder = ''
      const decoder = new StringDecoder('utf8')
      const deadline = setTimeout(() => failed(new DesktopError('Computer Use 启动超时', 'COMPUTER_USE_START_TIMEOUT')), 5000)
      const failed = (error: Error) => {
        clearTimeout(deadline)
        if (this.child !== child) return
        this.child = undefined
        if (!ready) reject(error)
        for (const waiter of this.pending.values()) waiter.reject(new DesktopError(error.message, 'COMPUTER_USE_DISCONNECTED', waiter.input ? 'unknown' : 'failed'))
        this.pending.clear(); child.kill()
      }
      child.stdout.on('data', bytes => {
        remainder += decoder.write(bytes)
        if (remainder.length > 32 * 1024 * 1024) { failed(new Error('Computer Use 响应过长')); return }
        let end: number
        while ((end = remainder.indexOf('\n')) >= 0) {
          const line = remainder.slice(0, end); remainder = remainder.slice(end + 1)
          try {
            const value = envelope.parse(JSON.parse(line))
            if (value.ready) { if (ready) throw new Error('Duplicate ready'); ready = true; clearTimeout(deadline); resolve(++this.generation) }
            else if (value.id) {
              const waiter = this.pending.get(value.id); this.pending.delete(value.id)
              if (value.error) {
                const code = typeof value.error === 'string' ? value.error : value.error.code
                const uncertain = ['INPUT_PARTIAL', 'FOCUS_CHANGED', 'COMPUTER_USE_CANCELLED', 'COMPUTER_USE_FAILED'].includes(code)
                waiter?.reject(new DesktopError(computerUseError(code), code, uncertain && waiter.input ? 'unknown' : code === 'COMPUTER_USE_CANCELLED' ? 'cancelled' : 'failed'))
              } else waiter?.resolve(value.result)
            } else if (value.error) failed(new Error('Computer Use 协议请求被拒绝'))
          } catch { failed(new Error('Computer Use 返回无效协议数据')); return }
        }
      })
      child.on('error', failed); child.on('exit', () => failed(new Error('Computer Use 后端已退出')))
      child.stdin.on('error', failed); child.stderr.resume()
    })
  }
  async request(action: string, args: Record<string, unknown>, signal: AbortSignal, input = false): Promise<unknown> {
    await this.prepare(signal)
    const child = this.child!
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      let grace: ReturnType<typeof setTimeout> | undefined
      const deadline = setTimeout(() => abort(), 30000)
      const abort = () => {
        if (grace) return
        child.stdin.write(JSON.stringify({ action: 'cancel', requestId: id }) + '\n')
        grace = setTimeout(() => { child.kill(); finish(new DesktopError('Computer Use 取消未确认，请先观察', 'COMPUTER_USE_CANCEL_UNCONFIRMED', input ? 'unknown' : 'cancelled')) }, 7000)
      }
      const cleanup = () => { clearTimeout(deadline); if (grace) clearTimeout(grace); signal.removeEventListener('abort', abort); this.pending.delete(id) }
      const finish = (error: Error) => { cleanup(); reject(error) }
      this.pending.set(id, { input, resolve: value => { cleanup(); resolve(value) }, reject: finish })
      signal.addEventListener('abort', abort, { once: true })
      child.stdin.write(JSON.stringify({ id, action, args }) + '\n')
      if (signal.aborted) abort()
    })
  }
  async close() {
    this.closed = true
    const child = this.child
    if (!child) return
    await new Promise<void>(resolve => { const timer = setTimeout(() => { child.kill(); resolve() }, 4000); child.once('exit', () => { clearTimeout(timer); resolve() }); child.stdin.end() })
  }
}
