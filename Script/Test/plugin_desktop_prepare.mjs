import { mkdtemp, mkdir, writeFile, cp, readFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import path from 'node:path'
import { configuredPluginTestModel } from './live-plugin-model.mjs'

const agent = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(import.meta.url)
const evidence = path.resolve(agent, '../.run/logs')
const root = await mkdtemp(path.join(tmpdir(), 'eden-plugin-desktop-'))
const model = configuredPluginTestModel(agent)
async function freePort() {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
async function run(script, args, env = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(path.join(agent, 'dist/runtime-win32-x64/node/node.exe'), [script, ...args], {
      cwd: agent, env: { ...process.env, ...env }, windowsHide: true, stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`)))
  })
}
try {
  const monPort = await freePort(), localPort = await freePort()
  const agentRoot = path.join(root, 'runtime/agent'), workspace = path.join(root, 'workspace')
  const userData = path.join(root, 'Data/Desktop/Agent'), runtime = path.join(root, 'runtime-staging')
  await mkdir(agentRoot, { recursive: true }); await mkdir(path.join(workspace, 'docs'), { recursive: true })
  await mkdir(userData, { recursive: true }); await mkdir(evidence, { recursive: true })
  await writeFile(path.join(root, '.monconfig'), '[project]\nNAME=Eden plugin acceptance\n')
  await writeFile(path.join(root, '.monworkspace'), '{}\n')
  await writeFile(path.join(agentRoot, '.monconfig'), `[service]\nNAME=Eden Agent\n[server]\nPORT=${monPort}\n`)
  for (const name of ['Eden Agent 统一插件系统.md', '智能体前端扩展.md', 'Eden Agent 工具与技能按需加载.md'])
    await cp(path.join(agent, '文档/技术', name), path.join(workspace, 'docs', name))
  const { createLocalRuntimeConfigStore } = require('../../frontend/desktop/src/app/local-runtime-config.cjs')
  const store = createLocalRuntimeConfigStore({ app: { isPackaged: true, getPath: () => userData }, agentRoot })
  store.save({ provider: model.provider, model: `${model.provider}/${model.id}`, baseUrl: model.baseUrl,
    contextWindow: model.contextWindow, maxOutputTokens: model.maxTokens, supportsImages: false,
    timeoutSeconds: 120, maxRetries: 1, apiKey: model.apiKey })
  await run('Script/Project/package_server.mjs', [runtime])
  await run('frontend/Script/Project/package_desktop.mjs', ['win32', 'x64'], {
    EDEN_AGENT_PACKAGE_RUNTIME: runtime, EDEN_AGENT_PACKAGE_OUTPUT: path.join(root, 'packaging'),
  })
  await mkdir(path.join(root, 'apps'))
  const app = path.join(root, 'apps/eden-agent')
  await rename(path.join(root, 'packaging/eden-agent-win32-x64'), app)
  const manifest = JSON.parse(await readFile(path.join(app, 'resources/runtime-manifest.json'), 'utf8'))
  const fixture = { root, app, agentRoot, workspace, userData, monPort, localPort,
    model: { provider: model.provider, id: model.id }, serverSha256: manifest.entrySha256,
    node: manifest.node, electron: '42.4.0', credentialLogged: false }
  await writeFile(path.join(evidence, 'plugin-desktop-fixture.json'), JSON.stringify(fixture, null, 2))
  await rm(runtime, { recursive: true, force: true })
  console.log(JSON.stringify({ prepared: true, root, node: manifest.node, model: fixture.model }))
} catch (error) {
  await rm(root, { recursive: true, force: true })
  throw new Error(String(error.message).replaceAll(model.apiKey, '[redacted]'))
}
