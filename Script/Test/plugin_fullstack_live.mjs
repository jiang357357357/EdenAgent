import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, access } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../../Server/src/bootstrap/container.ts'
import { loadConfig } from '../../Server/src/bootstrap/config.ts'
import { isolatedBrowser, until } from './browser-cdp.mjs'
import { pluginBrowserHarness } from './plugin-browser-harness.mjs'
import { configuredPluginTestModel } from './live-plugin-model.mjs'

const agentRoot = fileURLToPath(new URL('../../', import.meta.url))
const evidence = path.resolve(agentRoot, '../.run/logs'), root = await mkdtemp(path.join(tmpdir(), 'eden-plugin-live-'))
const workspace = path.join(root, 'workspace'), data = path.join(root, 'plugin-data'), checks = []
let host, web, browser, config, boot = {}, sessionId, requests = 0, subscription, timer
const model = configuredPluginTestModel(agentRoot)
const summary = { model: { provider: model.provider, id: model.id, endpoint: new URL(model.baseUrl).origin },
  scriptedResponses: false, userBusinessDataUsed: false, checks, modelRequests: 0, passed: false }
try {
  await mkdir(workspace); await mkdir(data); await mkdir(evidence, { recursive: true })
  await writeFile(path.join(workspace, 'backend-contract.md'), `# 当前宿主的组合插件协议
前端请读取 eden-ui-development 技能和 manage_ui_plugins.describe 获取真实 SDK。
plugin.json 的 components 可以同时声明 ui 和 runtimes。MCP stdio 运行时条目为 {"id":"backend","kind":"mcp_stdio","manifest":"runtime.json","enabledByDefault":true}。
runtime.json 为 {"schemaVersion":1,"command":"node","args":["/package/backend.mjs",${JSON.stringify(data)}],"cwd":"."}。
插件权限声明 {"capability":"process.execute","resource":"node","access":"execute","required":true,"description":"运行待办后端"}。安装默认不授予此权限，验收执行器会检查后单独批准，不要绕过授权。
后端由独立 Node 进程运行，不依赖 npm 包即可使用 node:sqlite 和 node:readline。持久数据库路径为 argv[2]/todos.db，不能保存在安装快照目录中。
MCP 用 stdin/stdout 每行一个 JSON-RPC 消息。initialize 响应 protocolVersion="2025-06-18"、capabilities={tools:{}}、serverInfo；忽略 notifications/initialized。tools/list 返回 tools 数组，每项有 name/description/inputSchema；tools/call 返回 {content:[{type:"text",text:JSON.stringify(value)}],structuredContent:value}，业务失败设 isError=true。stdout 只输出协议消息。
本任务约定工具名 todos，参数为 {action:"list"|"add"|"update"|"delete",title?,id?,done?}，返回 value={todos:[{id,title,done}]}；表结构自行设计。
UI 通过 host.callTool("call_mcp_tool",{runtimeId:"live-todos:backend",name:"todos",arguments:{action,...}}) 调用后端，检查 isError 后使用 structuredContent；ui.json capabilities.tools 声明 call_mcp_tool。
安装、检查、启停以 manage_ui_plugins 实际返回为准。不要调用外部网站或使用终端命令；所有工作仅在当前临时工作区中进行。
`)
  web = await pluginBrowserHarness(() => boot)
  config = { ...loadConfig({ EDEN_AGENT_DATA_ROOT: path.join(root, 'host'), EDEN_AGENT_PORT: '0', EDEN_AGENT_ALLOWED_ORIGINS: web.origin }, root), model }
  async function start() {
    host = await startServer(config); host.permissions.setMode('full_access')
    sessionId ??= host.sessions.repository.create('实际模型自主开发插件', [], null).id
    boot = { token: config.token, baseUrl: `http://127.0.0.1:${host.port}`, workspaceId: config.workspaceId, sessionId }
  }
  await start()
  subscription = host.sessions.repository.events.subscribe(event => {
    if (event.sessionId !== sessionId) return
    if (event.kind === 'permission.requested') {
      queueMicrotask(() => {
        for (const request of host.permissions.list(sessionId).filter(item => item.state === 'pending'))
          host.permissions.resolve(request.id, false, 'denied', false,
            '本次验收不运行终端命令；Node 已支持 node:sqlite。请用 write_file 编写文件，工具会自动创建父目录。')
      })
      return
    }
    if (event.kind !== 'model.request') return
    requests++; process.stdout.write(`Live provider request ${requests}\n`)
    if (requests > 40) queueMicrotask(() => { void host.sessions.cancel(sessionId) })
  })
  await fetch(`http://127.0.0.1:${host.port}/healthz`).catch(() => {})
  browser = await isolatedBrowser(path.join(root, 'browser'))
  async function navigate() {
    await browser.command('Page.navigate', { url: web.url })
    await until(() => browser.evaluate('typeof window.__call === "function"'))
  }
  await navigate()
  const call = (method, input) => browser.evaluate(`window.__call(${JSON.stringify(method)},${JSON.stringify(input)})`)
  await call('workspace.switch', { sessionId, path: workspace })
  timer = setTimeout(() => { void host.sessions.cancel(sessionId) }, 480_000)
  host.sessions.start(sessionId, `请为当前 Eden 应用自主开发并安装一个完整待办插件，id 固定 live-todos，版本 1.0.0，源码放工作区的 package 目录。
需求：侧边面板“自主开发待办”可以新增、列出、切换完成状态和删除待办；自定义独立 MCP 后端使用 SQLite 持久保存，重启后能恢复。
先发现并读取相关内置技能，再读取工作区 backend-contract.md 查询宿主后端协议。不要复制已有测试样例，也不要读取工作区外文件。请自行实现前端和后端业务代码。
前端输入使用 aria-label="待办标题"，新增／刷新按钮分别提供 data-action="add" 和 data-action="reload"，完成／删除按钮分别为 data-action="toggle"、data-action="delete"；每条待办的容器提供 data-todo-id，完成后可见“已完成”。这些是验收接口，布局和其余视觉由你设计。
不执行终端命令。写完文件后实际 inspect 和 install；后端所需权限将由测试执行器审查并授权，若因此不能启用请如实说明并结束，不自行绕过。需求已明确，无须询问用户。`)
  await host.sessions.waitForIdle(sessionId); clearTimeout(timer)
  summary.stage = 'inspect_generated_package'
  assert.ok(requests <= 40, 'Live model exceeded the bounded request budget')
  const packages = await call('plugin.list', {})
  const installed = packages.find(item => item.id === 'live-todos')
  assert.ok(installed, 'Actual model did not install the required plugin')
  assert.ok(installed.components.some(item => item.kind === 'ui'))
  assert.ok(installed.components.some(item => item.kind === 'mcp_stdio'))
  const grants = installed.permissions.map(permission => {
    assert.equal(permission.capability, 'process.execute', 'Generated plugin requested an unexpected permission')
    assert.equal(permission.resource, 'node')
    return { capability: permission.capability, resource: permission.resource, access: permission.access, decision: 'allowed' }
  })
  await call('plugin.permissions.set', { id: installed.id, revision: installed.revision, decisions: grants })
  await call('plugin.enable', { id: installed.id, enabled: true })
  summary.stage = 'start_generated_backend'
  await until(async () => (await call('mcp.status', {})).runtimes.some(item => item.pluginId === 'live-todos'))
  checks.push('实际模型自行编写并安装前端与 MCP 后端；测试执行器单独授权')
  async function open() {
    await until(() => browser.evaluate('Boolean(document.querySelector("[aria-label=打开应用扩展]"))'))
    await browser.evaluate('document.querySelector("[aria-label=打开应用扩展]").click()')
    await until(() => browser.evaluate('[...document.querySelectorAll("nav button")].some(item=>item.textContent.includes("自主开发待办"))'))
    await browser.evaluate('[...document.querySelectorAll("nav button")].find(item=>item.textContent.includes("自主开发待办")).click()')
    await until(() => browser.evaluate('Boolean(document.querySelector("[aria-label=待办标题]"))'))
  }
  async function click(action) {
    await until(() => browser.evaluate(`Boolean(document.querySelector('[data-action=${action}]:not(:disabled)'))`))
    await browser.evaluate(`document.querySelector('[data-action=${action}]').click()`)
  }
  async function title(value) {
    await browser.evaluate(`(()=>{const input=document.querySelector('[aria-label=待办标题]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`)
  }
  summary.stage = 'browser_crud'
  await open(); await title('LIVE_MODEL_PERSISTED_TODO'); await click('add')
  await until(() => browser.evaluate('document.querySelectorAll("[data-todo-id]").length === 1'))
  await click('toggle')
  await until(() => browser.evaluate('document.querySelector("[data-todo-id]").textContent.includes("已完成")'))
  await title('LIVE_MODEL_DELETE_TODO'); await click('add')
  await until(() => browser.evaluate('document.querySelectorAll("[data-todo-id]").length === 2'))
  await browser.evaluate('document.querySelectorAll("[data-todo-id]")[1].querySelector("[data-action=delete]").click()')
  await until(() => browser.evaluate('document.querySelectorAll("[data-todo-id]").length === 1'))
  checks.push('自主生成界面的真实浏览器增删改查')
  subscription(); subscription = undefined
  summary.stage = 'restart_host'
  await host.close(); await start(); await navigate()
  summary.stage = 'restart_backend_ready'
  await until(async () => (await call('mcp.status', {})).runtimes.some(item => item.pluginId === 'live-todos'))
  await open(); await click('reload')
  summary.stage = 'restart_data_restored'
  await until(() => browser.evaluate('document.querySelector("[data-todo-id]")?.textContent.includes("LIVE_MODEL_PERSISTED_TODO")'))
  checks.push('实际生成后端在宿主重启后恢复持久数据')
  await access(path.join(data, 'todos.db'))
  const database = new DatabaseSync(path.join(data, 'todos.db'), { readOnly: true })
  try { assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok') } finally { database.close() }
  const screenshot = await browser.command('Page.captureScreenshot', { format: 'png' })
  await writeFile(path.join(evidence, 'plugin-fullstack-live.png'), Buffer.from(screenshot.data, 'base64'))
  async function sourceHashes(directory, prefix = '') {
    const results = []
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name), name = prefix + entry.name
      if (entry.isDirectory()) results.push(...await sourceHashes(file, name + '/'))
      else { const bytes = await readFile(file); results.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }) }
    }
    return results
  }
  summary.generatedSources = await sourceHashes(path.join(workspace, 'package'))
  summary.operations = host.sessions.repository.database.connection.prepare('SELECT tool_name,state FROM tool_operations WHERE session_id=? ORDER BY rowid').all(sessionId)
  await call('plugin.uninstall', { id: 'live-todos' })
  await until(async () => (await call('mcp.status', {})).runtimes.length === 0)
  await access(path.join(data, 'todos.db')); checks.push('卸载停止生成的后端并保留业务数据库')
  assert.deepEqual(browser.errors, [])
  summary.stage = 'complete'
  summary.passed = true
} catch (error) {
  summary.error = String(error.message).replaceAll(model.apiKey, '[redacted]')
  if (browser) {
    summary.view = await browser.evaluate('document.body.innerText').catch(() => '')
    summary.backendStatus = await browser.evaluate("window.__call('mcp.status',{})").catch(reason => ({ error: reason.message }))
  }
  const sources = []
  async function collect(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name), name = prefix + entry.name
      if (entry.isDirectory()) await collect(file, name + '/')
      else sources.push({ path: name, content: (await readFile(file, 'utf8')).replaceAll(model.apiKey, '[redacted]') })
    }
  }
  await collect(path.join(workspace, 'package')).catch(() => {})
  await writeFile(path.join(evidence, 'plugin-fullstack-live-source.json'), JSON.stringify(sources, null, 2))
  if (host && sessionId) summary.operations = host.sessions.repository.database.connection.prepare('SELECT tool_name,state FROM tool_operations WHERE session_id=? ORDER BY rowid').all(sessionId)
  process.exitCode = 1
} finally {
  clearTimeout(timer); subscription?.()
  summary.modelRequests = requests
  await mkdir(evidence, { recursive: true })
  await writeFile(path.join(evidence, 'plugin-fullstack-live.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary))
  await browser?.close(); await web?.close(); await host?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
