import { z } from 'zod'
import { DesktopError, type DesktopDriver, type NativeObservation } from './contracts.ts'
import { ComputerUseTransport } from './computer-use-transport.ts'
import { COMPUTER_INPUT_DELIVERED } from '../../model-prompts/computer-use.ts'

const bounds = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().nonnegative(), height: z.number().nonnegative() })
const window = z.object({ pid: z.number().int().positive(), windowId: z.string().regex(/^\d+$/), app: z.string(), title: z.string(), bounds, minimized: z.boolean() })
const element = z.object({ token: z.string(), index: z.string(), parent: z.string().nullable(), role: z.string(), label: z.string(), value: z.string(),
  valueAvailable: z.boolean(), valueTruncated: z.boolean(), labelTruncated: z.boolean(), enabled: z.boolean(), actions: z.array(z.string()), frame: bounds.nullable(), focused: z.boolean() })
const observation = z.object({ window, snapshot: z.string().regex(/^[a-f0-9]{32}$/), elements: z.array(element).max(400),
  images: z.array(z.object({ mime: z.literal('image/png'), data: z.string().max(12 * 1024 * 1024) })).max(1), width: z.number().nonnegative(), height: z.number().nonnegative(),
  scale: z.number().positive(), frameValid: z.boolean().nullable(), screenshotIncluded: z.boolean(), elementsComplete: z.boolean(), truncated: z.boolean(),
  elementCoordinateSpace: z.literal('window_screenshot_pixels'), focusedElement: element.nullable(), captureBackend: z.literal('foreground_screen_copy'), textRequested: z.boolean() })

export async function createComputerUseDriver(): Promise<DesktopDriver> {
  if (process.platform !== 'win32') throw new DesktopError('Computer Use 当前仅支持 Windows', 'PLATFORM_UNSUPPORTED')
  return computerUseDriver(new ComputerUseTransport())
}
export function computerUseDriver(transport: Pick<ComputerUseTransport, 'prepare' | 'request' | 'close'>): DesktopDriver {
  return {
    prepare: signal => transport.prepare(signal),
    async windows(signal) { return z.array(window).max(512).parse(await transport.request('windows', {}, signal)) },
    async observe(target, signal, options): Promise<NativeObservation> {
      const value = observation.parse(await transport.request('observe', { pid: target.pid, window_id: target.windowId, app: target.app,
        screenshot: options?.screenshot ?? true, text: options?.text ?? false }, signal))
      const mapped = ({ parent, frame, ...item }: z.infer<typeof element>) => ({ ...item,
        ...(parent === null ? {} : { parent }), ...(frame === null ? {} : { frame }) })
      const { frameValid, focusedElement: _focus, elements: _elements, ...rest } = value
      return { ...rest, elements: value.elements.map(mapped),
        ...(frameValid === null ? {} : { frameValid }),
        focusedElement: value.focusedElement ? mapped(value.focusedElement) : null }
    },
    async act(name, args, signal) {
      if (args.delivery_mode === 'background') throw new DesktopError('Computer Use 使用前台输入，请明确选择 foreground', 'BACKGROUND_UNSUPPORTED')
      const result = z.object({ status: z.literal('delivered'), route: z.enum(['global_input', 'system_api', 'accessibility']), effect: z.literal('unverifiable').optional(), message: z.string().optional() })
        .parse(await transport.request(name, args, signal, true))
      return { status: result.status, route: result.route, ...(result.effect ? { effect: result.effect } : {}), message: COMPUTER_INPUT_DELIVERED }
    },
    close: () => transport.close(),
  }
}
