import { openSync, writeFileSync, fsyncSync, closeSync, unlinkSync } from 'node:fs'
import path from 'node:path'

/** Shares the offline import/recovery lock, so reviewers and converters cannot overlap. */
export function acquireReviewLock(root: string): () => void {
  const filename = path.join(root, '.conversion.lock'), descriptor = openSync(filename, 'wx', 0o600)
  try { writeFileSync(descriptor, 'Migration review host is running. Confirm it has stopped before removing a stale lock.\n'); fsyncSync(descriptor) }
  catch (error) { closeSync(descriptor); unlinkSync(filename); throw error }
  let released = false
  return () => { if (!released) { released = true; closeSync(descriptor); unlinkSync(filename) } }
}
