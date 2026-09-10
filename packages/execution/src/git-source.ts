import { realpathSync } from 'node:fs'
import path from 'node:path'
import { hostProcessEnvironment } from './host-environment.ts'
import { runProcess } from './process-runner.ts'

/** Host-controlled acquisition only. No model-selected commands, credentials, hooks or inherited Git config. */
export async function acquireGitSource(destination: string, uri: string, ref: string, signal: AbortSignal): Promise<string> {
  const url = new URL(uri)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Skill Git source must be a credential-free HTTPS repository URL')
  if (ref && (!/^[a-zA-Z0-9][a-zA-Z0-9._/\-]{0,255}$/.test(ref) || ref.includes('..'))) throw new Error('Invalid Git ref')
  const repository = path.join(realpathSync(destination), 'repository')
  const nullFile = process.platform === 'win32' ? 'NUL' : '/dev/null'
  const env = { ...hostProcessEnvironment(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: nullFile, GIT_TERMINAL_PROMPT: '0' }
  const git = ['-c', `core.hooksPath=${nullFile}`, '-c', 'credential.helper=', '-c', 'http.followRedirects=false',
    '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'submodule.recurse=false']
  const run = async (args: string[]) => {
    const result = await runProcess({ executable: 'git', args: [...git, ...args], cwd: destination, env, input: '', timeoutMs: 60000, maxOutputBytes: 65536, signal })
    if (result.exitCode !== 0) throw new Error('Git source acquisition failed; verify repository URL, ref and network availability')
    return result.stdout.trim()
  }
  await run(['init', '--template=', repository])
  await run(['-C', repository, 'fetch', '--depth=1', '--no-tags', '--', url.href, ref || 'HEAD'])
  const commit = await run(['-C', repository, 'rev-parse', '--verify', 'FETCH_HEAD^{commit}'])
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Git did not resolve a commit')
  await run(['-C', repository, 'checkout', '--detach', '--force', commit, '--'])
  return commit
}
