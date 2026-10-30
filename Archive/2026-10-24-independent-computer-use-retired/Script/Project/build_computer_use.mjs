import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import path from 'node:path'

export async function buildComputerUse(root, outdir) {
  if (process.platform !== 'win32') return
  const source = path.join(root, 'Server/src/modules/desktop/native/computer-use')
  const files = ['Windows.cs', 'Capture.cs', 'Accessibility.cs', 'Input.cs', 'Host.cs'].map(name => path.join(source, name))
  const digest = createHash('sha256')
  for (const file of files) digest.update(await readFile(file))
  const filename = `desktop-computer-use-${digest.digest('hex').slice(0, 16)}.exe`
  const directory = path.resolve(root, outdir)
  await mkdir(directory, { recursive: true })
  const compiler = path.join(process.env.SystemRoot ?? 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
  const wpf = path.join(path.dirname(compiler), 'WPF')
  let present = true
  try { await access(path.join(directory, filename)) } catch { present = false }
  if (!present) await promisify(execFile)(compiler, ['/nologo', '/target:exe', '/optimize+', '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll',
    '/r:System.Web.Extensions.dll', ...['UIAutomationClient.dll', 'UIAutomationTypes.dll', 'WindowsBase.dll'].map(name => `/r:${path.join(wpf, name)}`),
    `/out:${path.join(directory, filename)}`, ...files], { windowsHide: true, timeout: 60000 })
  await writeFile(path.join(directory, 'desktop-computer-use.json'), JSON.stringify({ filename }) + '\n')
}
