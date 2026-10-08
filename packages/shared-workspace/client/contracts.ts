export const MAX_FILE_BYTES = 16 * 1024 * 1024
export interface SharedFile { fileId: string; path: string; revision: number; deleted: boolean; sha256: string | null; size: number }
export interface Commit extends Omit<SharedFile, 'revision'> { operationId: string; baseRevision: number }
export interface Remote {
  request<T>(method: string, path: string, body?: unknown): Promise<T>
  upload(spaceId: string, sha256: string, bytes: Uint8Array): Promise<void>
  download(spaceId: string, sha256: string): Promise<Uint8Array>
}
export interface ClientOptions {
  dataRoot: string
  workspace(): { root: string; key: string }
  mutate<T>(root: string, work: () => Promise<T>): Promise<T>
  remote: Remote
}
export interface Binding { id: string; workspaceKey: string; spaceId: string; paused: boolean; cursor: number; lastSync: number | null }
export interface Conflict { id: string; path: string; local: Commit; remote: SharedFile | null; createdAt: number }
export interface Status {
  bound: boolean; spaceId: string | null; paused: boolean
  state: 'unbound' | 'idle' | 'syncing' | 'offline' | 'conflict' | 'paused'
  pending: number; conflicts: number; lastSync: number | null; error: string | null; root: string
}
export function fileRecord(value: unknown): SharedFile {
  const f = value as SharedFile
  if (!validFileIdentity(f)
    || !Number.isSafeInteger(f.revision) || f.revision < 1 || typeof f.deleted !== 'boolean'
    || !Number.isSafeInteger(f.size) || f.size < 0 || f.size > MAX_FILE_BYTES
    || !validFileContent(f)) {
    throw new Error('共享服务返回了无效的文件版本')
  }
  return { fileId: f.fileId, path: f.path, revision: f.revision, deleted: f.deleted, sha256: f.sha256, size: f.size }
}
function validFileIdentity(f: SharedFile): boolean {
  return !!f && typeof f === 'object' && typeof f.fileId === 'string'
    && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(f.fileId) && typeof f.path === 'string'
}
function validFileContent(f: SharedFile): boolean {
  if (f.deleted) return f.sha256 === null && f.size === 0
  return typeof f.sha256 === 'string' && /^[a-f0-9]{64}$/.test(f.sha256)
}
