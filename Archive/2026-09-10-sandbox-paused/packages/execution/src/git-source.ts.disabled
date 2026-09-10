import { existsSync, realpathSync } from 'node:fs'
import { runProcess } from './process-runner.ts'
import { sandboxArguments, sandboxExecutable } from './sandbox-arguments.ts'

/** Host-controlled acquisition only. No model-selected commands, credentials, hooks or inherited Git config. */
export async function acquireGitSource(destination: string, uri: string, ref: string, signal: AbortSignal): Promise<string> {
  const url = new URL(uri)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Skill Git source must be a credential-free HTTPS repository URL')
  if (ref && (!/^[a-zA-Z0-9][a-zA-Z0-9._/\-]{0,255}$/.test(ref) || ref.includes('..'))) throw new Error('Invalid Git ref')
  const base = [...sandboxArguments(), '--share-net', '--bind', realpathSync(destination), '/source', '--chdir', '/source',
    '--setenv', 'GIT_CONFIG_NOSYSTEM', '1', '--setenv', 'GIT_CONFIG_GLOBAL', '/dev/null', '--setenv', 'GIT_TERMINAL_PROMPT', '0']
  for (const filename of ['/etc/resolv.conf', '/etc/hosts', '/etc/ssl/certs']) {
    if (existsSync(filename)) base.push('--ro-bind', realpathSync(filename), filename)
  }
  const git = ['--', '/usr/bin/prlimit', '--as=1073741824:1073741824', '--cpu=30:30', '--nofile=256:256', '--fsize=67108864:67108864', '--',
    '/usr/bin/git', '-c', 'core.hooksPath=/dev/null', '-c', 'credential.helper=', '-c', 'http.followRedirects=false',
    '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'submodule.recurse=false']
  const run = async (args: string[]) => {
    const result = await runProcess({ executable: sandboxExecutable, args: [...base, ...git, ...args], input: '', timeoutMs: 60000, maxOutputBytes: 65536, signal })
    if (result.exitCode !== 0) throw new Error('Git source acquisition failed; verify repository URL, ref and network availability')
    return result.stdout.trim()
  }
  await run(['init', '--template=', '/source/repository'])
  await run(['-C', '/source/repository', 'fetch', '--depth=1', '--no-tags', '--', url.href, ref || 'HEAD'])
  const commit = await run(['-C', '/source/repository', 'rev-parse', '--verify', 'FETCH_HEAD^{commit}'])
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Git did not resolve a commit')
  await run(['-C', '/source/repository', 'checkout', '--detach', '--force', commit, '--'])
  return commit
}
