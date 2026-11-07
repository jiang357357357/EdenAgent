import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { startServer } from '../../Server/src/bootstrap/container.ts'
import { loadConfig } from '../../Server/src/bootstrap/config.ts'
import { isolatedBrowser, until } from './browser-cdp.mjs'
import { pluginBrowserHarness } from './plugin-browser-harness.mjs'

if (!process.argv[2]) throw new Error('Provide the existing shelf plugin source directory')
const original = path.resolve(process.argv[2]), root = await mkdtemp(path.join(tmpdir(), 'eden-shelf-backend-'))
const source = path.join(root, 'source'), evidence = fileURLToPath(new URL('../../../.run/logs/', import.meta.url))
let host, web, browser, boot = {}
const checks = []
try {
  await mkdir(source)
  // Only source files enter this fixture. The real user's business directory is never copied or opened.
  for (const file of ['plugin.json', 'runtime.json', 'ui.json', 'client.js', 'backend.mjs'])
    await writeFile(path.join(source, file), await readFile(path.join(original, file)))
  const descriptor = JSON.parse(await readFile(path.join(source, 'runtime.json'), 'utf8'))
  descriptor.args[1] = path.join(root, 'business')
  await writeFile(path.join(source, 'runtime.json'), JSON.stringify(descriptor))
  web = await pluginBrowserHarness(() => boot, {cacheDir:path.join(root,'vite-cache')})
  const config = loadConfig({ EDEN_AGENT_DATA_ROOT: path.join(root, 'host'), EDEN_AGENT_PORT: '0', EDEN_AGENT_ALLOWED_ORIGINS: web.origin }, root)
  host = await startServer(config); host.permissions.setMode('full_access')
  const sessionId = host.sessions.repository.create('书架后台隔离验收', [], null).id
  boot = { token: config.token, baseUrl: `http://127.0.0.1:${host.port}`, workspaceId: config.workspaceId, sessionId }
  browser = await isolatedBrowser(path.join(root, 'browser'))
  await browser.command('Page.navigate', { url: web.url })
  await until(() => browser.evaluate('typeof window.__call === "function"'), 60_000)
  const call = (method, params) => browser.evaluate(`window.__call(${JSON.stringify(method)},${JSON.stringify(params)})`)
  const preview = await call('plugin.inspect', { sourceType: 'local', sourceUri: source })
  await call('plugin.install_preview', { previewID: preview.previewID, activate: true, enabled: false, requireVerified: false })
  const enabled = await call('plugin.enable', { id: 'manga-shelf', enabled: true })
  assert.equal(enabled.permissionGrants[0].decision, 'allowed')
  await browser.evaluate(`window.__externalFetches=[];const originalFetch=window.fetch;window.fetch=(...args)=>{if(/mangadex/.test(String(args[0]))){window.__externalFetches.push(String(args[0]));throw Error('External source queries are excluded from this test');}return originalFetch(...args);};`)
  async function open() {
    await until(() => browser.evaluate('Boolean(document.querySelector("[aria-label=打开应用扩展]"))'))
    await browser.evaluate('document.querySelector("[aria-label=打开应用扩展]").click()')
    await until(() => browser.evaluate('[...document.querySelectorAll("nav button")].some(item=>item.textContent.includes("私藏书架"))'))
    await browser.evaluate('[...document.querySelectorAll("nav button")].find(item=>item.textContent.includes("私藏书架")).click()')
  }
  const text = () => browser.evaluate('document.body.innerText')
  await open()
  await until(async () => (await text()).includes('本机后端 · 已连接'))
  await until(async () => (await text()).includes('书架还空着') && !(await text()).includes('读取书架中'))
  assert.equal(await browser.evaluate('document.querySelectorAll(".ms-alert").length'), 0)
  assert.equal(await browser.evaluate('document.querySelectorAll(".ms-card").length'), 0)
  assert.equal(JSON.parse(await readFile(path.join(root, 'business/shelf.json'), 'utf8')).items.length, 0)
  checks.push('实际插件源码自动授权、启动后台，并通过真实 UI 工具读取空书架；不生成演示收藏')
  await browser.evaluate('[...document.querySelectorAll(".ms-row button")].find(item=>item.textContent.includes("+ 新增")).click()')
  await browser.evaluate(`(()=>{const input=document.querySelector('.ms-form input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'隔离测试书目');input.dispatchEvent(new Event('input',{bubbles:true}));})()`)
  await browser.evaluate('document.querySelector(".ms-form").requestSubmit()')
  await until(async () => (await text()).includes('隔离测试书目') && !await browser.evaluate('Boolean(document.querySelector(".ms-modal"))'))
  await browser.evaluate('[...document.querySelectorAll("[aria-label=状态筛选] button")].find(item=>item.textContent==="想读").click()')
  await until(() => browser.evaluate('document.querySelectorAll(".ms-card").length===1'))
  await browser.evaluate('[...document.querySelectorAll("[aria-label=状态筛选] button")].find(item=>item.textContent==="全部").click()')
  await until(async () => (await text()).includes('共 1 本') && !await browser.evaluate('Boolean(document.querySelector(".ms-alert"))'))
  assert.equal(JSON.parse(await readFile(path.join(root, 'business/shelf.json'), 'utf8')).items[0].title, '隔离测试书目')
  checks.push('实际新增书目持久化成功，全部与想读筛选均通过真实后台参数校验')
  await browser.evaluate('document.querySelector(\'[aria-label="关闭标签 私藏书架"]\').click()')
  await call('plugin.component.set', { id: 'manga-shelf', revision: enabled.revision, componentId: 'net', enabled: false })
  await until(async () => (await call('mcp.status', {})).runtimes.length === 0)
  await open()
  await until(async () => (await text()).includes('后台不可用') && (await text()).includes('后台连接失败：'))
  const failure = await browser.evaluate('document.querySelector(".ms-alert span").textContent')
  assert.ok(failure.length > '后台连接失败：'.length)
  await browser.evaluate('[...document.querySelectorAll(".ms-tab")].find(item=>item.textContent==="在线").click()')
  await browser.evaluate('[...document.querySelectorAll(".ms-online button")].find(item=>item.textContent==="搜索").click()')
  await until(async () => (await text()).includes(failure))
  assert.equal((await text()).includes('应用既不允许跨域直连'), false)
  assert.deepEqual(await browser.evaluate('window.__externalFetches'), [])
  checks.push('后台撤下后保留真实错误，不归咎跨域、不切换临时存储，也不自动搜索外部目录')
  await call('plugin.component.set', { id: 'manga-shelf', revision: enabled.revision, componentId: 'net', enabled: true })
  await until(async () => (await call('mcp.status', {})).runtimes.length === 1)
  await browser.evaluate('[...document.querySelectorAll(".ms-online button")].find(item=>item.textContent==="重新检查后端").click()')
  await until(async () => (await text()).includes('本机后端 · 已连接'))
  checks.push('后台重新启用后可重新检查并恢复连接')
  assert.deepEqual(browser.errors, [])
  const result = { passed: true, pluginVersion: enabled.version, checks, browserExceptions: browser.errors, externalCatalogQueries: 0 }
  await writeFile(path.join(evidence, 'plugin-shelf-backend-browser.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} catch (error) {
  console.error(JSON.stringify({completed:checks,body:await browser?.evaluate('document.body.innerText').catch(()=>''),browserExceptions:browser?.errors}))
  throw error
} finally {
  await browser?.close(); await web?.close(); await host?.close()
  assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()))
  await rm(root, { recursive: true, force: true })
}
