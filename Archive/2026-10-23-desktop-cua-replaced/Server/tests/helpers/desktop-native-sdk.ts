import { nativeDriverAdapter } from '../../src/modules/desktop/native-driver.ts'
import type * as Sdk from '@trycua/cua-driver'

export class FixtureDriverError extends Error {
  readonly tag = 'Tool'
  readonly inner: { errorCode: string }
  constructor(code: string) { super(`native fixture: ${code}`); this.inner = { errorCode: code } }
}

export function nativeSdkFixture() {
  let now = 0, startFailure: Error | undefined, observeFailure: Error | undefined
  let actionFailure: Error | undefined, refusedAction = false, cancelledStart: (() => void) | undefined
  let screenResultError: string | undefined
  const sessions = new Map<string, { active: boolean; touched: number }>()
  const starts: string[] = [], observations: Record<string, unknown>[] = [], actions: { name: string; args: Record<string, unknown> }[] = []
  const values = new Map<number, string>()
  let shutdown = 0, destroyed = 0, ended = 0
  const record = { new: (value: unknown) => value }
  const sdk = { StartSessionInput: record, EndSessionInput: record, GetScreenSizeInput: record, ListWindowsInput: record, GetWindowStateInput: record,
    DriverError: { Tool: { instanceOf: (error: unknown) => error instanceof FixtureDriverError } } } as unknown as typeof Sdk
  const requireActive = (name: string) => {
    const session = sessions.get(name)
    if (!session || !session.active || now - session.touched >= 300000) throw new FixtureDriverError('session_ended')
    session.touched = now
  }
  const window = (n: number) => ({ pid: n, windowId: BigInt(n), appName: 'Fixture', title: `Fixture ${n}`,
    bounds: { x: n * 400, y: 0, width: 400, height: 300 }, minimized: false })
  const api = {
    async startSession(input: { session: string }) {
      starts.push(input.session)
      if (startFailure) throw startFailure
      const previous = sessions.get(input.session), revived = Boolean(previous && (!previous.active || now - previous.touched >= 300000))
      sessions.set(input.session, { active: true, touched: now })
      cancelledStart?.()
      return { active: true, revived }
    },
    async endSession(input: { session: string }) { ended++; const session = sessions.get(input.session); if (session) session.active = false },
    async listWindows() { return { windows: [window(1), window(2)] } },
    async getScreenSize(input: { session: string }) {
      requireActive(input.session)
      return screenResultError ? { isError: true, errorCode: screenResultError } : { structuredJson: '{"width":1920,"height":1080}' }
    },
    async getWindowState(input: { session: string; pid: number }) {
      observations.push(input)
      requireActive(input.session)
      if (observeFailure) throw observeFailure
      return { windowTitle: `Fixture ${input.pid}`, windowBounds: window(input.pid).bounds, elements: [{ elementToken: `private-${observations.length}`,
        elementIndex: 1n, role: 'Edit', label: 'Input', value: values.get(input.pid) ?? '', enabled: true, actions: ['set_value'] }], images: [],
        screenshotWidth: 400, screenshotHeight: 300, elementsComplete: true, truncated: false }
    },
    async callTool(name: string, raw: string) {
      const args = JSON.parse(raw)
      actions.push({ name, args }); requireActive(args.session)
      if (actionFailure) throw actionFailure
      if (refusedAction) {
        sessions.get(args.session)!.active = false
        return { text: '', images: [], isError: true, errorCode: 'session_ended', degraded: false, rawJson: '{}' }
      }
      if (name === 'set_value') values.set(args.pid, args.value)
      return { text: '', images: [], isError: false, degraded: false, rawJson: '{}', action: { effect: 0, route: 0 } }
    },
    async shutdown() { shutdown++ }, uniffiDestroy() { destroyed++ },
  } as unknown as Parameters<typeof nativeDriverAdapter>[1]
  const driver = nativeDriverAdapter(sdk, api)
  return { driver, api, sdk, starts, observations, actions, sessions,
    idle: () => { now += 300001 },
    failStart: (error: Error | undefined) => { startFailure = error },
    failObserve: (error: Error | undefined) => { observeFailure = error },
    failAction: (error: Error | undefined) => { actionFailure = error },
    failScreenResult: (code: string | undefined) => { screenResultError = code },
    refuseAction: (value: boolean) => { refusedAction = value },
    duringStart: (callback: () => void) => { cancelledStart = callback },
    get cleanup() { return { shutdown, destroyed, ended } },
  }
}
