import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import path from 'node:path'

export async function buildDesktopObserver(root, outdir) {
  if (process.platform !== 'win32') return
  const source = path.join(root, 'Server/src/modules/desktop/native/InputObserver.cs')
  const hash = createHash('sha256').update(await readFile(source)).digest('hex').slice(0, 16)
  const filename = `desktop-input-observer-${hash}.exe`
  const directory = path.resolve(root, outdir)
  await mkdir(directory, { recursive: true })
  const target = path.join(directory, filename)
  const compiler = path.join(process.env.SystemRoot ?? 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
  let present = true
  try { await access(target) } catch { present = false }
  if (!present) await promisify(execFile)(compiler, ['/nologo', '/target:exe', '/optimize+', '/r:System.Windows.Forms.dll',
    '/r:System.Web.Extensions.dll', `/out:${target}`, source], { windowsHide: true, timeout: 60000 })
  await writeFile(path.join(directory, 'desktop-input-observer.json'), JSON.stringify({ filename }) + '\n')
}
