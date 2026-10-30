import type { Remote, SharedFile, Commit } from '../client/contracts.ts'
import type { SourceStatus } from './source-contracts.ts'

export type Role = 'owner' | 'editor' | 'viewer'
export interface Identity { deviceId: string; name: string; publicKey: string; privateKey: string }
export interface Peer { deviceId: string; name: string; publicKey: string; key: string; addresses: string[]; revoked: boolean; allowRemote?: boolean; dedicated?: boolean }
export interface HostAdministrator { deviceId: string; publicKey: string }
export interface SharedHost { deviceId: string; name: string; addresses: string[]; local: boolean; reachable: boolean; canPublish: boolean; canManage: boolean; dedicated: boolean; directorySources?: boolean; directoryCreate?: boolean; error: string | null }
export interface Space { id: string; name: string; role: Role; hostDeviceId: string; hostName: string; reachable?: boolean; source?: SourceStatus }
export interface Member { deviceId: string; name: string; role: Role }
export interface NetworkPeer { deviceId: string; name: string; addresses: string[]; paired: boolean; discovered: boolean; revoked: boolean; error?: string | null }
export interface NetworkStatus { deviceId: string; name: string; addresses: string[]; port: number; listening: boolean; discoveryError: string | null; peers: NetworkPeer[] }
export interface Invitation { id: string; deviceId: string; name: string; publicKey: string; addresses: string[]; expiresAt: number; secret: string }
export interface LanOptions {
  connectionPosture?: 'lan' | 'cloud'
  dataRoot: string; name?: string; active(): boolean; canPublish(): boolean; host?: string; port?: number; discovery?: boolean
  dedicated?: boolean; publicAddresses?: string[]; administrators?: HostAdministrator[]
  tls?: { cert: Buffer; key: Buffer }
}
export interface LanRuntime {
  remote: Remote
  start(): Promise<void>
  suspend(): Promise<void>
  close(): Promise<void>
  network(): NetworkStatus
  invite(): { code: string; expiresAt: number }
  pair(code: string, address?: string): Promise<{ paired: true }>
  connectHost(code: string, address?: string): Promise<{ paired: true; deviceId: string }>
  hosts(): Promise<{ hosts: SharedHost[] }>
  hostRequest<T>(hostDeviceId: string, method: string, path: string, body?: unknown): Promise<T>
  deploymentIdentity(): HostAdministrator
  acceptsSpace(spaceId: string): boolean
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
