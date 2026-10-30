import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

const execute = promisify(execFile)
const invoke = (command, args, options = {}) => execute(command, args, { windowsHide: true, timeout: 300_000, maxBuffer: 1024 * 1024, ...options })
export async function processSourceIdentity(root) {
  const hash = createHash('sha256')
  const add = async (directory, prefix = '') => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git' || entry.name === 'dist' || entry.name === '.run') continue
      const filename = path.join(directory, entry.name), relative = prefix + entry.name
      if (entry.isDirectory()) await add(filename, relative + '/')
      else if (entry.name.endsWith('.go') || ['go.mod', 'go.sum'].includes(relative)) hash.update(relative).update(await readFile(filename))
    }
  }
  await add(root)
  const commit = (await invoke('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim()
  const dirty = Boolean((await invoke('git', ['-C', root, 'status', '--porcelain', '--untracked-files=normal'])).stdout.trim())
  return { sourceCommit: commit, sourceHash: hash.digest('hex'), sourceDirty: dirty }
}
export async function hostGoCompiler() {
  try {
    const version = (await invoke('go', ['version'])).stdout.trim()
    return { version, run: (args, options = {}) => invoke('go', args, { ...options, env: { ...process.env, ...options.env } }),
      file: filename => readFile(filename, 'utf8'), native: value => Promise.resolve(value) }
  } catch (error) {
    if (process.platform !== 'win32' || error.code !== 'ENOENT') throw error
    const version = (await invoke('wsl.exe', ['--exec', 'go', 'version'])).stdout.trim()
    const native = async value => (await invoke('wsl.exe', ['--exec', 'wslpath', '-u', path.resolve(value)])).stdout.trim()
    return { version, native, file: async filename => (await invoke('wsl.exe', ['--exec', 'cat', filename])).stdout,
      run: (args, { env = {} } = {}) => invoke('wsl.exe', ['--exec', 'env', ...Object.entries(env).map(([key, value]) => `${key}=${value}`), 'go', ...args]) }
  }
}
export async function buildHostMonpm(compiler, root, output, architecture, identity) {
  const target = await compiler.native(output), directory = await compiler.native(root)
  await compiler.run(['-C', directory, 'build', '-trimpath', '-buildvcs=false', '-ldflags',
    `-s -w -X monpm/internal/buildinfo.Version=${identity.componentVersion} -X monpm/internal/buildinfo.GitCommit=${identity.sourceCommit} -X monpm/internal/buildinfo.BuildID=shared-host-${identity.sourceHash.slice(0, 12)}`,
    '-o', target, './cmd/monpm'], { env: { GOOS: 'linux', GOARCH: architecture === 'x64' ? 'amd64' : 'arm64', CGO_ENABLED: '0' } })
}
export async function hostGoNotices(compiler) {
  const goroot = (await compiler.run(['env', 'GOROOT'])).stdout.trim()
  const cache = (await compiler.run(['env', 'GOMODCACHE'])).stdout.trim()
  const join = process.platform === 'win32' && goroot.startsWith('/') ? path.posix.join : path.join
  const goLicense = async () => {
    try { return await compiler.file(join(goroot, 'LICENSE')) }
    catch {
      const minor = /go(\d+\.\d+)/.exec(compiler.version)?.[1]
      if (!minor) throw new Error('Unable to locate Go runtime license')
      return compiler.file(`/usr/share/doc/golang-${minor}-go/copyright`)
    }
  }
  const texts = await Promise.all([goLicense(),
    compiler.file(join(cache, 'golang.org/x/sys@v0.30.0/LICENSE')),
    compiler.file(join(cache, 'golang.org/x/text@v0.22.0/LICENSE'))])
  return texts.map((text, index) => `${['Go standard library', 'golang.org/x/sys', 'golang.org/x/text'][index]}\n${text}`).join('\n\n')
}
