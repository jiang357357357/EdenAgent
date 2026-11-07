import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { startServer } from '../../Server/src/bootstrap/container.ts'
import { loadConfig } from '../../Server/src/bootstrap/config.ts'
import { configuredPluginTestModel } from './live-plugin-model.mjs'
import { isolatedBrowser, until } from './browser-cdp.mjs'
import { pluginBrowserHarness } from './plugin-browser-harness.mjs'
import { liveExtensionBrowser } from './extension-live-browser.mjs'
import { constrainExtensionAuthor, liveExtensionTools } from './extension-live-tools.mjs'

const root = await mkdtemp(path.join(tmpdir(), 'eden-extension-live-'))
const agentRoot = fileURLToPath(new URL('../../', import.meta.url)), evidence = path.resolve(agentRoot, '../.run/logs')
const workspace = path.join(root, 'workspace'), pluginId = 'live-extension-todos'
const model = configuredPluginTestModel(agentRoot)
const summary = { passed: false, scriptedResponses: false, sourceProvidedByHarness: false, userBusinessDataUsed: false,
  model: { provider: model.provider, id: model.id, endpoint: new URL(model.baseUrl).origin, reasoning: model.reasoning },
  modelRequests: 0, rounds: [], checks: [], nodeVersion: process.version, authoringToolAllowlist: liveExtensionTools }
let host, browser, web, config, sessionId, boot = {}, subscription, timer, stopReason
const redact = value => String(value).replaceAll(model.apiKey, '[redacted]')
async function sources(directory, prefix = '') {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name), relative = prefix + entry.name
    if (entry.isDirectory()) files.push(...await sources(filename, relative + '/'))
    else { const bytes = await readFile(filename); files.push({ path: relative, bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), content: redact(bytes.toString('utf8')) }) }
  }
  return files
}
async function checkpoint(stage) {
  summary.stage = stage; summary.modelRequests = requests
  await writeFile(path.join(evidence, 'extension-platform-live.json'), JSON.stringify(summary, null, 2))
  console.log(`Live extension stage: ${stage}; model requests: ${requests}`)
}
let requests = 0
try {
  await mkdir(workspace); await mkdir(evidence, { recursive: true })
  web = await pluginBrowserHarness(() => boot, { cacheDir: path.join(root, 'vite-cache') })
  config = { ...loadConfig({ EDEN_AGENT_DATA_ROOT: path.join(root, 'host'), EDEN_AGENT_PORT: '0', EDEN_AGENT_ALLOWED_ORIGINS: web.origin }, root), model }
  async function start() {
    host = await startServer(config); host.permissions.setMode('full_access')
    constrainExtensionAuthor(host, workspace, pluginId)
    sessionId ??= host.sessions.repository.create('真实模型自主开发原生扩展', [], null).id
    boot = { token: config.token, baseUrl: `http://127.0.0.1:${host.port}`, workspaceId: config.workspaceId, sessionId }
  }
  await start(); browser = await isolatedBrowser(path.join(root, 'browser'))
  const ui = liveExtensionBrowser(browser, pluginId)
  async function navigate() {
    await browser.command('Page.navigate', { url: web.url })
    await until(() => browser.evaluate('typeof window.__call === "function"'))
  }
  await navigate(); await ui.call('workspace.switch', { sessionId, path: workspace })
  subscription = host.sessions.repository.events.subscribe(event => {
    if (event.sessionId !== sessionId) return
    if (event.kind === 'model.request') {
      requests++; console.log(`Live model request ${requests}`)
      if (requests > 72) { stopReason = 'request budget exceeded'; queueMicrotask(() => { void host.sessions.cancel(sessionId) }) }
    }
    if (event.kind === 'permission.requested') queueMicrotask(() => {
      for (const request of host.permissions.list(sessionId).filter(item => item.state === 'pending'))
        host.permissions.resolve(request.id, false, 'denied', false, '本次验收不运行终端、不安装依赖；请使用公开插件协议和工作区文件工具完成任务。')
    })
  })
  async function ask(prompt) {
    const before = requests
    timer = setTimeout(() => { stopReason = 'model turn timeout'; void host.sessions.cancel(sessionId) }, 480_000)
    try { host.sessions.start(sessionId, prompt); await host.sessions.waitForIdle(sessionId) }
    finally { clearTimeout(timer) }
    assert.equal(stopReason, undefined, stopReason)
    return requests - before
  }
  await checkpoint('authoring')
  const task = `请为当前 Eden 应用自主开发并安装一个原生 API 2 待办扩展。插件 id 固定 ${pluginId}，版本 1.0.0，完整源码放当前工作区 package 目录。需求已明确，无须询问用户。
先发现并读取相关内置技能，再通过 manage_ui_plugins.describe 查询本机真实协议；重点使用返回的 extensions（API 2），不要使用 API 1 的共享 React 插件。你需要自己设计和编写实现，测试执行器不会提供源码、业务实现或脚手架。
功能：独立页面“自主扩展待办”能新增、列出、切换完成状态、删除待办；初始为空，不内置演示数据。使用宿主提供的后端持久存储保存真实数据，不用前端临时状态冒充持久化。页面与原生树形视图“自主扩展任务树”读取同一份数据。提供工具栏刷新命令（id 为 refresh），操作后更新包含“待办”和实际总数的状态栏。至少声明一个可编辑的字符串设置（标题为“列表标题”，默认值“我的待办”），页面读取当前账号 global 范围的该设置显示列表标题，与工作台默认设置范围一致。声明一个打开页面的快捷键。
页面验收接口：输入框 aria-label="待办标题"；新增／刷新按钮 data-action="add"／"reload"；每条待办容器 data-task-id，内部完成／删除按钮 data-action="toggle"／"delete"；完成后文字可见“已完成”。布局、命名以外的视觉和业务结构由你自主实现。按钮应显示实际错误，不能吞掉后端失败。
只能在当前临时工作区读写文件，不读取工作区外文件，不复制现有样例，不使用终端、不联网、不安装依赖。此任务不需要独立 MCP／连接器进程，也不需要额外工具能力。写完后实际 inspect 和 install，并查询 status 检查界面加载情况。浏览器交互由验收执行器在隔离页面完成，不使用 desktop/cua 或其他真实桌面工具；完成安装和 status 后结束本轮等待反馈，不自行寻找真实客户端窗口。出现错误请自己修正后重试；最后如实报告实际完成和验证范围。`
  let roundRequests = await ask(task), lastError
  for (let round = 0; round < 3; round++) {
    const entry = { round: round + 1, modelRequests: roundRequests, passed: false, checks: [] }
    summary.rounds.push(entry)
    try {
      await checkpoint(`round_${round + 1}_browser`)
      const installed = (await ui.call('plugin.list', {})).find(item => item.id === pluginId)
      assert.ok(installed?.enabled, 'Model did not install and enable the required extension')
      const module = (await ui.call('plugin.ui.list', {})).modules.find(item => item.pluginId === pluginId)
      assert.equal(module?.document.apiVersion, 2, 'Model did not author an API 2 extension')
      assert.ok(Object.keys(module.document.contributes.configuration).length)
      assert.ok(module.document.contributes.keybindings.length)
      const marker = `LIVE_NATIVE_TASK_${round + 1}`
      await ui.crud(marker, entry.checks)
      await browser.evaluate('document.querySelector("[aria-label=打开工作台命令]").click()')
      await until(() => browser.evaluate('Boolean(document.querySelector("[aria-label=工作台命令]"))'))
      await browser.evaluate(`[...document.querySelectorAll('[role=option]')].find(item=>item.textContent.includes('打开扩展设置')).click()`)
      await until(() => browser.evaluate('Boolean(document.querySelector("[aria-label=列表标题]:not(:disabled)"))'))
      await browser.evaluate(`(()=>{const input=document.querySelector('[aria-label=列表标题]');input.value='模型扩展设置验收';input.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));})()`)
      const setting = Object.entries(module.document.contributes.configuration).find(([, value]) => value.title === '列表标题')
      assert.ok(setting)
      await until(async () => {
        const result = await ui.call('plugin.ui.call', { pluginId, componentId: module.componentId, revision: module.revision, viewId: '$extension', sessionId,
          action: 'extension.state', requestId: crypto.randomUUID(), input: { namespace: 'configuration', scope: 'global', key: setting[0] } })
        return result.value === '模型扩展设置验收'
      })
      await browser.evaluate('document.querySelector("[aria-label=扩展设置] header button").click()')
      await ui.open('自主扩展待办'); await ui.click('reload')
      await until(() => ui.frame('document.body.innerText.includes("模型扩展设置验收")'))
      entry.checks.push('工作台修改声明的设置后，生成页面显示新值')
      const captured = await browser.command('Page.captureScreenshot')
      await writeFile(path.join(evidence, 'extension-platform-live.png'), Buffer.from(captured.data, 'base64'))
      entry.marker = marker; entry.passed = true; summary.checks.push(...entry.checks)
      lastError = undefined; break
    } catch (error) {
      lastError = error; entry.error = redact(error.message)
      entry.workbench = await browser.evaluate('document.body.innerText').catch(() => '')
      entry.frame = await ui.frame('document.body.innerText').catch(() => '')
      entry.status = await ui.call('plugin.ui.list', {}).catch(() => null)
      await checkpoint(`round_${round + 1}_failed`)
      if (round === 2 || requests >= 60) break
      const feedback = `真实浏览器验收发现问题，请修复同一个插件并重新 inspect/install，不创建另一个插件，不改验收接口。第 ${round + 1} 轮错误：${entry.error}。
主工作台显示：${entry.workbench.slice(-5000)}。
生成页面显示：${String(entry.frame).slice(-5000)}。
请查询 manage_ui_plugins.status 检查 Worker／视图真实状态，读取你自己的源码定位原因；修复后保留已有业务数据，版本推进一个补丁号。不要声称尚未执行的浏览器验收已通过。`
      roundRequests = await ask(feedback)
      await navigate()
    }
  }
  if (lastError) throw lastError
  subscription(); subscription = undefined
  await checkpoint('restart_verification')
  const persistedMarker = summary.rounds.findLast(item => item.passed).marker
  await host.close(); await start(); await navigate()
  await ui.open('自主扩展待办')
  await until(() => ui.frame('Boolean(document.querySelector("[aria-label=待办标题]"))'))
  await ui.click('reload')
  await until(() => ui.frame(`[...document.querySelectorAll('[data-task-id]')].some(item=>item.textContent.includes(${JSON.stringify(persistedMarker)})&&item.textContent.includes('已完成'))`))
  summary.checks.push('完整宿主重启后，生成扩展恢复已保存的待办与完成状态')
  await until(() => ui.frame('document.body.innerText.includes("模型扩展设置验收")'))
  summary.checks.push('宿主重启后，生成扩展继续读取已保存设置')
  const database = host.sessions.repository.database.connection
  assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  const storedBefore = database.prepare('SELECT COUNT(*) AS count FROM extension_state WHERE plugin_id=?').get(pluginId).count
  assert.ok(storedBefore > 0)
  summary.generatedSources = (await sources(path.join(workspace, 'package'))).map(({ content, ...file }) => file)
  summary.operations = database.prepare('SELECT tool_name,state,error_json FROM tool_operations WHERE session_id=? ORDER BY rowid').all(sessionId)
  assert.ok(summary.operations.some(item => item.tool_name === 'load_skill'))
  assert.ok(summary.operations.some(item => item.tool_name === 'manage_ui_plugins'))
  summary.unavailableToolAttempts = summary.operations.filter(item => !liveExtensionTools.includes(item.tool_name))
  assert.ok(summary.unavailableToolAttempts.every(item => item.state === 'failed'), 'Unexpected tool escaped authoring allowlist')
  await ui.call('plugin.uninstall', { id: pluginId })
  await until(async () => !(await ui.call('plugin.ui.list', {})).modules.some(item => item.pluginId === pluginId))
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM extension_state WHERE plugin_id=?').get(pluginId).count, storedBefore)
  summary.checks.push('卸载撤下生成的扩展，后端业务状态保留')
  assert.deepEqual(browser.errors, [])
  summary.browserExceptions = browser.errors; summary.passed = true
  await checkpoint('complete')
} catch (error) {
  summary.error = redact(error.stack ?? error)
  summary.browserExceptions = browser?.errors ?? []
  summary.workbench = await browser?.evaluate('document.body.innerText').catch(() => '')
  const generated = await sources(path.join(workspace, 'package')).catch(() => [])
  await mkdir(evidence, { recursive: true })
  await writeFile(path.join(evidence, 'extension-platform-live-source.json'), JSON.stringify(generated, null, 2))
  if (host && sessionId) summary.operations = host.sessions.repository.database.connection.prepare('SELECT tool_name,state,error_json FROM tool_operations WHERE session_id=? ORDER BY rowid').all(sessionId)
  process.exitCode = 1
} finally {
  clearTimeout(timer); subscription?.()
  summary.modelRequests = requests
  await mkdir(evidence, { recursive: true })
  await writeFile(path.join(evidence, 'extension-platform-live.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary))
  await browser?.close(); await web?.close(); await host?.close()
  assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir())); assert.ok(path.basename(root).startsWith('eden-extension-live-'))
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
