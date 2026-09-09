import { createTcpBridge } from './tcp-bridge.ts'

export function createAdminBridge(port: number, authorize: () => void, signal: AbortSignal) {
  return createTcpBridge({ address: '127.0.0.1', port, limit: 4 }, authorize, signal)
}
