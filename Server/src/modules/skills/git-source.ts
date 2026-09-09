import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { acquireGitSource } from '@eden/execution'
import { readLocalSnapshot } from './snapshot.ts'

export async function readGitSnapshot(uri: string, ref: string, subpath: string, signal: AbortSignal) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'eden-skill-source-'))
  try {
    const commit = await acquireGitSource(directory, uri, ref, signal)
    const data = await readLocalSnapshot(path.join(directory, 'repository'), subpath)
    return { data, commit }
  } finally { await rm(directory, { recursive: true, force: true }) }
}
