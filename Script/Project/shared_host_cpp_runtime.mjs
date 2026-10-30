import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { downloadRuntime } from './shared_host_runtime_assets.mjs'

const execute = promisify(execFile)
async function text(url, cache) {
  const filename = path.join(cache, 'gcc-' + new URL(url).pathname.split('/').at(-1) + '.txt')
  try { return await readFile(filename, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
  let contents
  for (let attempt = 0; attempt < 2 && contents === undefined; attempt++) try {
    // Developer-side resource preparation only; deployed hosts never need curl or internet access.
    contents = (await execute(process.platform === 'win32' ? 'curl.exe' : 'curl', ['--fail', '--silent', '--show-error',
      '--connect-timeout', '15', '--max-time', '60', '--socks5-hostname', '127.0.0.1:10808', url], { windowsHide: true })).stdout
    process.stdout.write('Obtained GCC notices using GitHub SOCKS proxy 127.0.0.1:10808\n')
  } catch { /* Retry the local proxy before using a direct developer-side request. */ }
  if (contents === undefined) {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new Error(`Runtime metadata unavailable: ${response.status}`)
    contents = await response.text()
  }
  const marker = url.endsWith('COPYING3') ? 'GNU GENERAL PUBLIC LICENSE' : 'GCC RUNTIME LIBRARY EXCEPTION'
  if (!contents.includes(marker)) throw new Error('Invalid GCC license resource')
  await writeFile(filename, contents); return contents
}
async function metadata(cache, architecture) {
  const machine = architecture === 'x64' ? 'amd64' : 'arm64'
  const base = architecture === 'x64' ? 'https://archive.ubuntu.com/ubuntu/' : 'https://ports.ubuntu.com/ubuntu-ports/'
  const cached = path.join(cache, `jammy-updates-${machine}-Packages.gz`)
  let bytes
  try { bytes = await readFile(cached) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const response = await fetch(`${base}dists/jammy-updates/main/binary-${machine}/Packages.gz`, { redirect: 'error', signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error('Unable to read official C++ runtime package metadata')
    bytes = Buffer.from(await response.arrayBuffer()); await writeFile(cached, bytes)
  }
  const packages = gunzipSync(bytes).toString('utf8').split('\n\n').map(block => Object.fromEntries(block.split('\n')
    .filter(line => /^[A-Za-z][^: ]*: /.test(line)).map(line => { const split = line.indexOf(': '); return [line.slice(0, split), line.slice(split + 2)] })))
  return { base, packages }
}
function dataTar(bytes) {
  if (bytes.subarray(0, 8).toString() !== '!<arch>\n') throw new Error('Invalid Debian runtime package')
  for (let offset = 8; offset + 60 <= bytes.length;) {
    const name = bytes.subarray(offset, offset + 16).toString().trim().replace(/\/$/, '')
    const size = Number(bytes.subarray(offset + 48, offset + 58).toString().trim())
    if (!Number.isSafeInteger(size) || size < 0 || offset + 60 + size > bytes.length) throw new Error('Invalid runtime package member')
    if (name === 'data.tar.xz' || name === 'data.tar.zst') return { name, bytes: bytes.subarray(offset + 60, offset + 60 + size) }
    offset += 60 + size + size % 2
  }
  throw new Error('No C++ runtime data archive')
}
async function extractPackage(cache, work, origin, record, pattern, target) {
  if (!record || !/^[a-f0-9]{64}$/.test(record.SHA256) || !/^pool\/main\/g\/gcc-\d+\/[^/]+\.deb$/.test(record.Filename)) throw new Error('Unexpected C++ runtime package metadata')
  const filename = path.join(cache, path.basename(record.Filename))
  await downloadRuntime(origin + record.Filename, filename, record.SHA256)
  const directory = path.join(work, record.Package); await mkdir(directory)
  const archive = dataTar(await readFile(filename)), packed = path.join(directory, archive.name)
  await writeFile(packed, archive.bytes)
  const entries = (await execute('tar', ['-tf', packed], { windowsHide: true })).stdout.split(/\r?\n/)
  const member = entries.find(value => pattern.test(value) && !value.split('/').includes('..'))
  if (!member) throw new Error(`Missing C++ runtime content: ${record.Package}`)
  await execute('tar', ['-xf', packed, '-C', directory, member], { windowsHide: true })
  const source = path.join(directory, member)
  if (!(await stat(source)).isFile()) throw new Error('Invalid C++ runtime content')
  await writeFile(target, await readFile(source))
  return { name: record.Package, version: record.Version, source: record.Source, url: origin + record.Filename, sha256: record.SHA256 }
}

export async function prepareCppRuntime(cache, directory, architecture) {
  const { base, packages } = await metadata(cache, architecture)
  const cpp = packages.find(record => record.Package === 'libstdc++6')
  const gcc = packages.find(record => record.Package === 'libgcc-s1')
  const gccBase = packages.find(record => record.Package === /^gcc-(\d+)/.exec(cpp?.Source ?? '')?.[0] + '-base')
  const work = path.join(directory, 'cpp'); await mkdir(work)
  const sources = []
  sources.push(await extractPackage(cache, work, base, cpp, /\/libstdc\+\+\.so\.6\.\d+\.\d+$/, path.join(directory, 'libstdcpp')))
  sources.push(await extractPackage(cache, work, base, gcc, /\/libgcc_s\.so\.1$/, path.join(directory, 'libgcc')))
  await extractPackage(cache, work, base, gccBase, /\/copyright$/, path.join(directory, 'copyright.gcc.txt'))
  const license = await text('https://raw.githubusercontent.com/gcc-mirror/gcc/releases/gcc-12.3.0/COPYING3', cache)
  const exception = await text('https://raw.githubusercontent.com/gcc-mirror/gcc/releases/gcc-12.3.0/COPYING.RUNTIME', cache)
  return { sources, notice: `GNU C++ runtime, unmodified Ubuntu jammy-updates packages.\nCorresponding source: https://launchpad.net/ubuntu/+source/${cpp.Source.split(' ')[0]}\n\n`
    + await readFile(path.join(directory, 'copyright.gcc.txt'), 'utf8') + '\n' + license + '\n' + exception }
}
