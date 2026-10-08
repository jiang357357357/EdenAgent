import type { Remote, SharedFile, Commit } from '../client/contracts.ts'

export type Role = 'owner' | 'editor' | 'viewer'
export interface Identity { deviceId: string; name: string; publicKey: string; privateKey: string }
export interface Peer { deviceId: string; name: string; publicKey: string; key: string; addresses: string[]; revoked: boolean }
export interface Space { id: string; name: string; role: Role; hostDeviceId: string; hostName: string; reachable?: boolean }
export interface Member { deviceId: string; name: string; role: Role }
export interface NetworkPeer { deviceId: string; name: string; addresses: string[]; paired: boolean; discovered: boolean; revoked: boolean; error?: string | null }
export interface NetworkStatus { deviceId: string; name: string; addresses: string[]; port: number; listening: boolean; discoveryError: string | null; peers: NetworkPeer[] }
export interface Invitation { id: string; deviceId: string; name: string; publicKey: string; addresses: string[]; expiresAt: number; secret: string }
export interface LanOptions { dataRoot: string; name?: string; active(): boolean; canPublish(): boolean; host?: string; port?: number; discovery?: boolean }
export interface LanRuntime {
  remote: Remote
  start(): Promise<void>
  suspend(): Promise<void>
  close(): Promise<void>
  network(): NetworkStatus
  invite(): { code: string; expiresAt: number }
  pair(code: string, address?: string): Promise<{ paired: true }>
  revoke(deviceId: string): void
}
export class LanError extends Error {
  readonly status: number
  readonly body: { error: string; current?: SharedFile | null }
  constructor(status: number, message: string, body: { error: string; current?: SharedFile | null } = { error: message }) { super(message); this.status = status; this.body = body }
}
export interface LibraryRequest { method: string; path: string; body?: unknown }
export interface LibraryResponse { status: number; body: unknown }
export type ValidCommit = Commit
