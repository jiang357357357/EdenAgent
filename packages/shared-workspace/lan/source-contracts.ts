export interface SourceBinding { spaceId: string; path: string; identity: string }
export interface SourceStatus {
  path: string; state: 'idle' | 'syncing' | 'offline' | 'conflict'
  pending: number; conflicts: number; error: string | null
}
export interface DirectoryListing {
  path: string; parent: string | null; entries: { name: string; path: string }[]; truncated: boolean
  selectable: boolean; reason: string | null
}
