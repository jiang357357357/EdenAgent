import { cp, mkdir, readFile, realpath, rename } from 'node:fs/promises'
import path from 'node:path'

export async function copyVideoSources(root, output) {
  await mkdir(output, { recursive: true })
  await cp(path.join(root, 'Server/resources/video-context'), path.join(output, 'video-context'), {
    recursive: true, filter: filename => !filename.includes('__pycache__') && !filename.endsWith('.pyc'),
  })
}

export async function packageVideoRuntime(root, output, runtime = process.env.EDEN_AGENT_VIDEO_RUNTIME_ROOT ?? path.join(root, 'Data/runtime/video-context')) {
  await copyVideoSources(root, output)
  const prepared = process.env.EDEN_AGENT_VIDEO_RUNTIME_PREPARED
  if (prepared) {
    if (await realpath(prepared) === await realpath(runtime)) throw new Error('Prepared video runtime must be a separate staging directory')
    const expected = await readFile(path.join(runtime, 'runtime.json'))
    if (!(await readFile(path.join(prepared, 'runtime.json'))).equals(expected)) throw new Error('Prepared video runtime metadata differs')
    await rename(prepared, path.join(output, 'video-runtime'))
    return
  }
  // Required resource: fail clearly instead of shipping a nonfunctional video tool.
  await cp(runtime, path.join(output, 'video-runtime'), { recursive: true, verbatimSymlinks: true,
    filter: filename => !filename.includes('__pycache__') && !filename.endsWith('.pyc') })
}
