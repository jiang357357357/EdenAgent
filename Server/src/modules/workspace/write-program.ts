export const writeProgram = String.raw`
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const within = name => name.startsWith('/workspace/');
const hash = value => createHash('sha256').update(value).digest('hex');
export default async function(input) {
  const filename = path.resolve('/workspace', input.path);
  if (!within(filename)) throw new Error('Write path escapes workspace');
  const parent = await fs.realpath(path.dirname(filename));
  if (parent !== '/workspace' && !within(parent)) throw new Error('Parent link escapes workspace');
  let old, mode = 0o600;
  try {
    const canonical = await fs.realpath(filename);
    if (!within(canonical)) throw new Error('File link escapes workspace');
    const stat = await fs.stat(filename);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Existing file is not a small regular file');
    old = await fs.readFile(filename);
    mode = stat.mode & 0o777;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (input.expectedSha256 && (!old || hash(old) !== input.expectedSha256)) throw new Error('File changed since it was read');
  if (input.createOnly && old !== undefined) throw new Error('File already exists');
  const temporary = path.join(parent, '.eden-write-' + randomUUID());
  try {
    await fs.writeFile(temporary, input.content, { mode, flag: 'wx' });
    if (input.createOnly) { await fs.link(temporary, filename); await fs.unlink(temporary); }
    else await fs.rename(temporary, filename);
  } finally { await fs.rm(temporary, { force: true }); }
  return { path: input.path, bytes: Buffer.byteLength(input.content), sha256: hash(input.content) };
}
`
