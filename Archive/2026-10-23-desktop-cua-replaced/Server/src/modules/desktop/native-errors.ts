import type * as NativeSdk from '@trycua/cua-driver'
import { DesktopError } from './contracts.ts'

export function nativeCode(code: string | undefined, fallback: string): string {
  return code && /^[A-Za-z0-9_]{1,100}$/.test(code) ? code : fallback
}

export function nativeErrorCode(error: unknown, sdk: Pick<typeof NativeSdk, 'DriverError'>, fallback: string): string {
  const code = sdk.DriverError.Tool.instanceOf(error) ? error.inner.errorCode : fallback
  return nativeCode(code, fallback)
}

export function nativeDriverError(error: unknown, code: string, operation: string, input: boolean): DesktopError {
  if (error instanceof DesktopError) return error
  const ended = code === 'session_ended' || code === 'session_not_found'
  const message = ended ? '桌面驱动会话已结束，请重新观察窗口以恢复；本次操作不会自动重放' :
    `桌面驱动调用失败（${code}），请重新观察窗口；结果不明的输入不得直接重放`
  return Object.assign(new DesktopError(message, code, input && !ended ? 'unknown' : 'failed', {
    operation, recovery: ['observe_window'], sessionEnded: ended,
    errorKind: error && typeof error === 'object' && 'tag' in error ? String(error.tag).slice(0, 100) : 'Error',
  }), { cause: error })
}
