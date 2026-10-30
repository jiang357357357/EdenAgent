import type { CuaDriver as NativeDriver, ToolResult } from '@trycua/cua-driver'
import { z } from 'zod'
import { DesktopError, type DesktopDriver, type NativeWindow, type DriverAction } from './contracts.ts'
import { projectNativeObservation } from './native-observation.ts'
import { NativeDesktopSession } from './native-session.ts'
import { nativeCode, nativeDriverError, nativeErrorCode } from './native-errors.ts'

type NativeApi = Pick<NativeDriver, 'getScreenSize' | 'listWindows' | 'getWindowState' | 'callTool' | 'startSession' | 'endSession' | 'shutdown' | 'uniffiDestroy'>

export async function createNativeDriver(): Promise<DesktopDriver> {
  if (process.platform !== 'win32') throw new DesktopError('桌面控制当前仅支持 Windows', 'PLATFORM_UNSUPPORTED')
  const sdk = await import('@trycua/cua-driver')
  const driver = sdk.CuaDriver.create(undefined) as NativeDriver
  return nativeDriverAdapter(sdk, driver)
}

export function nativeDriverAdapter(sdk: typeof import('@trycua/cua-driver'), driver: NativeApi): DesktopDriver {
  const session = new NativeDesktopSession((name, signal) => driver.startSession(sdk.StartSessionInput.new({ session: name }), { signal }))
  const call = async <T>(operation: string, signal: AbortSignal, input: boolean, work: () => Promise<T>): Promise<T> => {
    signal.throwIfAborted()
    try { return await work() }
    catch (error) {
      if (signal.aborted) throw signal.reason
      const code = error instanceof DesktopError ? error.code : nativeErrorCode(error, sdk, 'DRIVER_CALL_FAILED')
      session.failed(code)
      throw nativeDriverError(error, code, operation, input)
    }
  }
  const windowValue = (w: import('@trycua/cua-driver').WindowInfo): NativeWindow => ({
    pid: w.pid ?? 0, windowId: w.windowId.toString(), app: w.appName, title: w.title,
    bounds: w.bounds, minimized: w.minimized ?? false,
  })
  return {
    prepare: signal => call('start_session', signal, false, () => session.prepare(signal)),
    async screenSize(signal) {
      return call('get_screen_size', signal, false, async () => {
        const result = await driver.getScreenSize(sdk.GetScreenSizeInput.new({ session: session.name }), { signal })
        if (result.isError) throw nativeDriverError(new Error('Native read refused'), nativeCode(result.errorCode, 'DRIVER_READ_FAILED'), 'get_screen_size', false)
        return z.object({ width: z.number().positive(), height: z.number().positive() }).parse(JSON.parse(result.structuredJson ?? '{}'))
      })
    },
    async windows(signal) {
      const result = await call('list_windows', signal, false, () => driver.listWindows(sdk.ListWindowsInput.new({}), { signal }))
      return result.windows.filter(w => w.pid && w.windowId > 0n).map(windowValue)
    },
    async observe(window, signal, options) {
      const state = await call('get_window_state', signal, false, () => driver.getWindowState(sdk.GetWindowStateInput.new({ pid: window.pid, windowId: BigInt(window.windowId),
        session: session.name, maxElements: 400, maxDepth: 20, maxDimension: 1600, includeScreenshot: options?.screenshot ?? true }), { signal }))
      return projectNativeObservation(window, state, options?.screenshot ?? true)
    },
    async act(name, args, signal) {
      const result = await call(name, signal, true, () => driver.callTool(name, JSON.stringify({ ...args, session: session.name }), { signal }))
      const action = projectDriverAction(result)
      if (action.code) session.failed(action.code)
      return action
    },
    async close() {
      try {
        if (session.started) await driver.endSession(sdk.EndSessionInput.new({ session: session.name }), { signal: AbortSignal.timeout(5000) })
      } catch (error) {
        const code = nativeErrorCode(error, sdk, 'DRIVER_CLOSE_FAILED')
        if (code !== 'session_ended' && code !== 'session_not_found') throw nativeDriverError(error, code, 'end_session', false)
      } finally {
        try { await driver.shutdown() } finally { driver.uniffiDestroy() }
      }
    },
  }
}

function driverActionFacts(result: ToolResult): Partial<DriverAction> {
  const effect = result.action?.effect
  const facts: Partial<DriverAction> = {}
  const effects = ['confirmed', 'partial', 'unverifiable', 'suspected_noop', 'refused'] as const
  const routes = ['accessibility', 'synthetic_events', 'global_input', 'system_api', 'dom', 'trusted_input'] as const
  if (effect !== undefined && effects[effect]) facts.effect = effects[effect]
  if (result.action && routes[result.action.route]) facts.route = routes[result.action.route]
  const evidence = result.action?.evidence?.flatMap(e => e.kind === 0 ? ['value_readback' as const] : e.kind === 1 ? ['window_change' as const] : [])
  if (evidence?.length) facts.evidence = [...new Set(evidence)]
  if (result.errorCode && /^[A-Za-z0-9_]{1,100}$/.test(result.errorCode)) facts.code = result.errorCode
  return facts
}

export function projectDriverAction(result: ToolResult): DriverAction {
  const effect = result.action?.effect
  const facts = driverActionFacts(result)
  if (effect === 1) return { ...facts, status: 'unknown', message: '输入仅部分送达；请核对当前内容，禁止直接重复完整输入' }
  if (effect === 2) return { ...facts, status: 'unknown', message: '动作可能已生效，驱动无法读取结果；请依据后续观察确认，禁止直接重放' }
  if (effect === 3) return { ...facts, status: 'unknown', message: '驱动未观察到预期变化；请核对焦点和窗口状态，禁止直接重放未知输入' }
  if (result.isError) return { ...facts, status: 'refused', message: '桌面驱动拒绝操作；请重新观察，按错误码选择可用方式', code: facts.code ?? 'DRIVER_REFUSED' }
  if (effect === 0) return { ...facts, status: 'verified', message: '驱动已验证该动作的直接结果；完整任务结果仍需观察确认' }
  if (effect === 4) return { ...facts, status: 'refused', message: '动作未执行', code: facts.code ?? 'ACTION_REFUSED' }
  return { ...facts, status: 'delivered', message: '动作已送达，请重新观察确认结果' }
}
