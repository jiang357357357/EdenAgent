import { cp, mkdir, readFile, writeFile, stat, rename, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1]
  if (!['--python', '--ffmpeg-dir', '--model-dir', '--output', '--uv'].includes(key) || !value) throw new Error('Usage: npm run setup:video -- --python <python.exe> --ffmpeg-dir <FFmpeg distribution> [--model-dir <Whisper tiny directory>] [--output <new runtime directory>] [--uv <uv.exe>]')
  args.set(key, value)
}
if (!args.has('--python') || !args.has('--ffmpeg-dir')) throw new Error('必须指定 --python（Python 3.11–3.13）和 --ffmpeg-dir（含 bin/ffmpeg、bin/ffprobe 和许可证的发行目录）')
if (process.platform !== 'win32') throw new Error('此自包含 Python 分发组装器目前支持 Windows；其他系统可通过 EDEN_AGENT_VIDEO_RUNTIME_ROOT 指定兼容 runtime.json')
const output = path.resolve(args.get('--output') ?? path.join(root, 'Data/runtime/video-context'))
if (existsSync(output)) throw new Error(`拒绝覆盖已有运行时：${output}`)
const source = path.join(root, 'Server/resources/video-context')
const staging = `${output}.staging-${randomUUID()}`
await mkdir(staging, { recursive: true })

function run(command, parameters, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, parameters, { windowsHide: true, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' })
    let text = ''
    if (capture) child.stdout.on('data', chunk => { text += chunk })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve(text.trim()) : reject(new Error(`视频运行时准备失败，退出码 ${code}`)))
  })
}

try {
  const originalPython = path.resolve(args.get('--python'))
  const pythonInfo = JSON.parse(await run(originalPython, ['-I', '-c', 'import sys,json;print(json.dumps({"base":sys.base_prefix,"version":list(sys.version_info[:3])}))'], true))
  if (pythonInfo.version[0] !== 3 || pythonInfo.version[1] < 11 || pythonInfo.version[1] > 13) throw new Error('需要 Python 3.11–3.13')
  const python = path.join(staging, 'python/python.exe')
  // Copy a clean Python base, then install only the frozen media dependencies.
  await cp(pythonInfo.base, path.join(staging, 'python'), { recursive: true, filter: filename => {
    const relative = path.relative(pythonInfo.base, filename).replaceAll('\\', '/').toLowerCase()
    return !['lib/site-packages/', 'scripts/', '__pycache__/'].some(part => relative.includes(part))
      && relative !== 'lib/site-packages' && !relative.endsWith('.pyc') && path.basename(filename) !== 'EXTERNALLY-MANAGED'
  } })
  await stat(python)
  const uv = args.get('--uv') ?? 'uv'
  await run(uv, ['pip', 'install', '--python', python, '--requirement', path.join(source, 'requirements.txt')])
  await run(uv, ['pip', 'install', '--python', python, '--no-deps', source])
  const ffmpegSource = path.resolve(args.get('--ffmpeg-dir'))
  await stat(path.join(ffmpegSource, 'bin/ffmpeg.exe'))
  await stat(path.join(ffmpegSource, 'bin/ffprobe.exe'))
  if (!existsSync(path.join(ffmpegSource, 'LICENSE')) && !existsSync(path.join(ffmpegSource, 'LICENSE.txt'))) throw new Error('FFmpeg 发行目录必须带许可证')
  await cp(ffmpegSource, path.join(staging, 'ffmpeg'), { recursive: true })
  if (args.has('--model-dir')) {
    const modelSource = path.resolve(args.get('--model-dir'))
    for (const filename of ['model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt']) await stat(path.join(modelSource, filename))
    await cp(modelSource, path.join(staging, 'models/tiny'), { recursive: true })
  } else {
    await run(python, ['-I', '-m', 'video_understanding_mcp.cli', 'install-model', 'tiny',
      '--model-cache-dir', path.join(staging, 'models'), '--cache-dir', path.join(staging, 'setup-cache')])
  }
  await writeFile(path.join(staging, 'runtime.json'), JSON.stringify({ version: 1,
    python: 'python/python.exe', ffmpeg: 'ffmpeg/bin/ffmpeg.exe', ffprobe: 'ffmpeg/bin/ffprobe.exe',
    model: 'tiny', pythonVersion: pythonInfo.version.join('.'),
    sourceCommit: 'b1495070863fc65372c986df52f992b9e5f40c02',
    requirementsSha256: createHash('sha256').update(await readFile(path.join(source, 'requirements.txt'))).digest('hex'),
  }, null, 2) + '\n')
  await cp(path.join(source, 'WHISPER-LICENSE'), path.join(staging, 'models/LICENSE'))
  await cp(path.join(source, 'EDEN-NOTICE.md'), path.join(staging, 'NOTICE.md'))
  await rename(staging, output)
  // Run after relocation: a successful setup cannot depend on its staging path.
  await run(path.join(output, 'python/python.exe'), ['-I', '-c', 'import mcp,faster_whisper,video_understanding_mcp;print("VideoContext ready")'])
  process.stdout.write(`视频运行时已准备：${output}\n`)
} catch (error) {
  if (path.dirname(staging) !== path.dirname(output) || !path.basename(staging).startsWith(`${path.basename(output)}.staging-`)) throw new Error('拒绝清理不属于此次安装的路径', { cause: error })
  await rm(staging, { recursive: true, force: true })
  throw error
}
