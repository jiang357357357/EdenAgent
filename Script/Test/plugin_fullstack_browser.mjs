import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { startServer } from '../../Server/src/bootstrap/container.ts'
import { loadConfig } from '../../Server/src/bootstrap/config.ts'
import { writeTodoPackage } from '../../Server/tests/integration/plugin-ui/fullstack-fixture.ts'
import { isolatedBrowser, until } from './browser-cdp.mjs'
import { pluginBrowserHarness } from './plugin-browser-harness.mjs'
import { recordedModel } from '@eden/runtime-pi/testing'

const root = await mkdtemp(path.join(tmpdir(), 'eden-fullstack-browser-'))
const agentRoot = fileURLToPath(new URL('../../', import.meta.url)), evidence = path.resolve(agentRoot, '../.run/logs')
const source = path.join(root, 'source'), data = path.join(root, 'plugin-data'), checks = []
let host, browser, web, config, sessionId, model, boot = {}
try {
  await writeTodoPackage(source, data)
  web = await pluginBrowserHarness(() => boot, {cacheDir:path.join(root,'vite-cache')})
  model = await recordedModel([{ text: '界面操作结束后继续处理消息' }])
  config = { ...loadConfig({ EDEN_AGENT_DATA_ROOT: path.join(root, 'host'), EDEN_AGENT_PORT: '0', EDEN_AGENT_ALLOWED_ORIGINS: web.origin }, root), model: model.config }
  async function start() {
    host = await startServer(config); host.permissions.setMode('full_access')
    sessionId ??= host.sessions.repository.create('前后端插件浏览器验收', [], null).id
    boot = { token: config.token, baseUrl: `http://127.0.0.1:${host.port}`, workspaceId: config.workspaceId, sessionId }
  }
  await start()
  browser = await isolatedBrowser(path.join(root, 'browser'))
  async function navigate() {
    await browser.command('Page.navigate', { url: web.url })
    await until(() => browser.evaluate('typeof window.__call === "function"'))
  }
  await navigate()
  const call = (method, input) => browser.evaluate(`window.__call(${JSON.stringify(method)},${JSON.stringify(input)})`)
  async function install(grant = true) {
    const preview = await call('plugin.inspect', { sourceType: 'local', sourceUri: source })
    await call('plugin.install_preview', { previewID: preview.previewID, activate: true, enabled: false, requireVerified: false })
    if (grant) {
      await call('plugin.permissions.set', { id: 'fullstack-todos', revision: preview.revision,
        decisions: [{ capability: 'process.execute', resource: 'node', access: 'execute', decision: 'allowed' }] })
      await call('plugin.enable', { id: 'fullstack-todos', enabled: true })
      await until(async () => (await call('mcp.status', {})).runtimes.some(item => item.revision === preview.revision))
    }
    return preview
  }
  async function open() {
    await until(() => browser.evaluate('Boolean(document.querySelector("[aria-label=打开应用扩展]"))'))
    await browser.evaluate('document.querySelector("[aria-label=打开应用扩展]").click()')
    await until(() => browser.evaluate('[...document.querySelectorAll("nav button")].some(item=>item.textContent.includes("持久化待办"))'))
    await browser.evaluate('[...document.querySelectorAll("nav button")].find(item=>item.textContent.includes("持久化待办")).click()')
    await until(() => browser.evaluate('Boolean(document.querySelector(".fullstack-todos"))'))
  }
  async function click(action) {
    await until(() => browser.evaluate(`Boolean(document.querySelector('[data-action=${action}]:not(:disabled)'))`))
    await browser.evaluate(`document.querySelector('[data-action=${action}]').click()`)
  }
  async function title(value) {
    await browser.evaluate(`(()=>{const input=document.querySelector('[aria-label=待办标题]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`)
  }
  const first = await install(false)
  host.permissions.setMode('restricted')
  const refused = await browser.evaluate(`window.__call('plugin.enable',{id:'fullstack-todos',enabled:true}).then(()=>false,()=>true)`)
  assert.equal(refused, true); checks.push('受限模式缺少后端授权时拒绝激活')
  host.permissions.setMode('full_access')
  await call('plugin.enable', { id: 'fullstack-todos', enabled: true })
  assert.equal((await call('plugin.read', {id:'fullstack-todos'})).permissionGrants[0].decision, 'allowed')
  checks.push('完全访问下启用插件自动完成后台授权')
  await until(async () => (await call('mcp.status', {})).runtimes.length === 1)
  await open(); await click('reload')
  await until(() => browser.evaluate('document.querySelector("[data-backend-version]").textContent.includes("1")'))
  checks.push('前端通过宿主调用独立后端')
  await title('浏览器真实添加'); await click('add')
  await until(() => browser.evaluate('document.querySelectorAll("[data-todo-id]").length === 1'))
  await click('toggle')
  await until(() => browser.evaluate('document.querySelector("[data-todo-id]").textContent.includes("已完成")'))
  await title('浏览器真实删除'); await click('add')
  await until(() => browser.evaluate('document.querySelectorAll("[data-todo-id]").length === 2'))
  await browser.evaluate('document.querySelectorAll("[data-todo-id]")[1].querySelector("[data-action=delete]").click()')
  await until(() => browser.evaluate('document.querySelectorAll("[data-todo-id]").length === 1'))
  checks.push('真实浏览器增删改查')
  await click('fail')
  await until(() => browser.evaluate('document.querySelector("[data-todos-error]")?.textContent.includes("EXPECTED_TODO_BUSINESS_FAILURE")'))
  checks.push('后端业务失败展示')
  await host.close(); await start(); await navigate()
  await until(async () => (await call('mcp.status', {})).runtimes.length === 1)
  await open(); await click('reload')
  await until(() => browser.evaluate('document.querySelector("[data-todo-id]")?.textContent.includes("浏览器真实添加（已完成）")'))
  checks.push('宿主与后端重启后恢复数据')
  await writeTodoPackage(source, data, 2)
  await install()
  if (!await browser.evaluate('Boolean(document.querySelector("[data-todos-version]"))')) await open()
  await until(() => browser.evaluate('document.querySelector("[data-todos-version]")?.getAttribute("data-todos-version") === "2"'))
  await click('reload')
  await until(() => browser.evaluate('document.querySelector("[data-backend-version]").textContent.includes("2") && document.querySelectorAll("[data-todo-id]").length === 1'))
  checks.push('前后端共同升级与数据库迁移')
  await click('slow')
  await until(async () => (await call('mcp.operations', { sessionId })).items.some(item => item.state === 'running'))
  await call('turn.start', { sessionId, text: '界面工具运行期间提交的聊天消息' })
  assert.equal(model.requests.length, 0)
  checks.push('在途插件请求不阻塞同连接查询和聊天入队')
  await browser.evaluate(`document.querySelector('[aria-label="关闭标签 持久化待办"]').click()`)
  await until(async () => (await call('mcp.operations', { sessionId })).items[0].state !== 'running')
  await host.sessions.waitForIdle(sessionId)
  assert.equal(model.requests.length, 1)
  checks.push('关闭视图取消后端在途请求')
  await call('plugin.enable', { id: 'fullstack-todos', enabled: false })
  await until(async () => (await call('mcp.status', {})).runtimes.length === 0)
  await until(() => browser.evaluate('!document.querySelector("[data-todos-version]") && !document.querySelector("style[data-eden-plugin-ui]")'))
  checks.push('停用后前后端与样式撤下')
  await call('plugin.enable', { id: 'fullstack-todos', enabled: true })
  await until(async () => (await call('mcp.status', {})).runtimes.length === 1)
  await open(); await click('reload')
  await until(() => browser.evaluate('document.querySelectorAll("[data-todo-id]").length === 1'))
  checks.push('重新启用保留数据')
  await click('slow')
  let disconnectedOperation
  await until(async () => {
    disconnectedOperation = (await call('mcp.operations', { sessionId })).items.find(item => item.state === 'running')
    return Boolean(disconnectedOperation)
  })
  await browser.command('Page.reload', { ignoreCache: true })
  await until(() => browser.evaluate('typeof window.__call === "function"'))
  await until(async () => (await call('mcp.operations', { sessionId })).items.find(item => item.id === disconnectedOperation.id)?.state === 'unknown')
  await until(async () => (await call('mcp.status', {})).runtimes.length === 0)
  await until(async () => (await call('mcp.status', {})).runtimes.length === 1)
  await open(); await click('reload')
  await until(() => browser.evaluate('document.querySelectorAll("[data-todo-id]").length === 1'))
  checks.push('断开浏览器连接取消在途请求并恢复后端')
  await mkdir(evidence, { recursive: true })
  const screenshot = await browser.command('Page.captureScreenshot', { format: 'png' })
  await writeFile(path.join(evidence, 'plugin-fullstack-browser.png'), Buffer.from(screenshot.data, 'base64'))
  await call('plugin.uninstall', { id: 'fullstack-todos' })
  await until(async () => (await call('mcp.status', {})).runtimes.length === 0)
  await until(() => browser.evaluate('!document.querySelector("[data-todos-version]")'))
  await access(path.join(data, 'todos.db')); checks.push('卸载停止后端并保留业务数据')
  assert.deepEqual(browser.errors, [])
  const summary = { passed: true, model: 'recorded only for queued chat; UI, backend and storage are real', checks, browserExceptions: browser.errors }
  await writeFile(path.join(evidence, 'plugin-fullstack-browser.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary))
} catch (error) {
  await mkdir(evidence, { recursive: true })
  const view = browser ? await browser.evaluate('document.body.innerText').catch(() => '') : ''
  await writeFile(path.join(evidence, 'plugin-fullstack-browser.json'), JSON.stringify({ passed: false, checks, error: error.message, view }, null, 2))
  throw error
} finally {
  await browser?.close(); await web?.close(); await host?.close(); await model?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
