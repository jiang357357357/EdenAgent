import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { startServer } from '../../Server/src/bootstrap/container.ts'
import { loadConfig } from '../../Server/src/bootstrap/config.ts'
import { isolatedBrowser, until } from './browser-cdp.mjs'
import { pluginBrowserHarness } from './plugin-browser-harness.mjs'

const root = await mkdtemp(path.join(tmpdir(), 'eden-extension-browser-'))
const source = path.join(root, 'source'), workspace = path.join(root, 'workspace'), evidence = fileURLToPath(new URL('../../../.run/logs/', import.meta.url))
const checks = [], boot = {}
const lifecycleChannel = 'eden-extension-lifecycle-' + crypto.randomUUID()
let web, host, browser, secondBrowser, config, sessionId
const frameSessions = new Map()
async function frameEval(expression) {
  try {
  const targets = (await browser.command('Target.getTargets')).targetInfos.filter(target => target.type === 'iframe')
  const target = targets.at(-1)
  if (target) {
    if (!frameSessions.has(target.targetId)) frameSessions.set(target.targetId, (await browser.command('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId)
    const result = await browser.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, frameSessions.get(target.targetId))
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }
  const frames = (await browser.command('Page.getFrameTree')).frameTree.childFrames ?? []
  const frame = frames.at(-1)?.frame.id
  if (!frame) return undefined
  const { executionContextId } = await browser.command('Page.createIsolatedWorld', { frameId: frame, worldName: 'extension-acceptance' })
  const result = await browser.command('Runtime.evaluate', { expression, contextId: executionContextId, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
  } catch (error) {
    if (/No frame|No target|Session closed|Cannot find context|Inspected target navigated/.test(String(error))) return undefined
    throw error
  }
}
try {
  await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../Project/create_extension.mjs', import.meta.url)), source, 'platform-browser'])
  const document = JSON.parse(await readFile(path.join(source, 'ui.json'), 'utf8'))
  document.capabilities = { ...document.capabilities, documents: true, tools: ['create_memo', 'list_memos_page'] }
  document.views.push({ id: 'editor', title: '扩展文本编辑器', slot: 'page', renderer: 'editor', entry: 'editor.html', filePatterns: ['*.txt'] })
  for (const [id, title] of [['environment', '检查执行环境'], ['note', '创建真实备忘'], ['hang', '阻塞扩展宿主'], ['tree', '打开数据树']]) {
    document.contributes.commands.push({ id, title, when: { sessionAvailable: true } })
    document.contributes.menus.push({ command: id, location: 'toolbar' })
  }
  document.contributes.menus.push({ command: 'increment', location: 'view/title', view: 'main' }, { command: 'increment', location: 'view/item/context', view: 'items' }, { command: 'environment', location: 'editor/context' })
  document.contributes.keybindings.push({command:'environment',key:'Ctrl+Alt+G'}, {command:'environment',key:'Ctrl+Alt+H'})
  let sourceJs = await readFile(path.join(source, 'extension.js'), 'utf8')
  sourceJs = sourceJs.replace("api.log('info',", `api.registerCommand('environment', async context => { return context.storage('global').update('environment', { worker: typeof document === 'undefined' && typeof window === 'undefined' }); });
  api.registerCommand('note', async context => { await context.callTool('create_memo', { title: '扩展浏览器真实备忘', kind: 'note' }); await context.showMessage('真实备忘已创建'); });
  api.registerCommand('hang', () => { while (true) {} });
  api.registerCommand('tree', context => context.openView('items'));
  api.log('info',`)
  sourceJs = sourceJs.replace(/\n}\n$/, `\n  return { dispose() { const channel = new BroadcastChannel(${JSON.stringify(lifecycleChannel)}); channel.postMessage('disposed'); } };\n}\n`)
  await writeFile(path.join(source, 'extension.js'), sourceJs)
  const formView = (await readFile(path.join(source, 'view.html'), 'utf8'))
    .replace('<button id="increment">增加并保存</button>', '<form id="counter-form"><button id="increment" type="submit">增加并保存</button></form>')
    .replace("document.getElementById('increment').onclick = async () => {", "document.getElementById('counter-form').onsubmit = async event => { event.preventDefault();")
  await writeFile(path.join(source, 'view.html'), formView)
  await writeFile(path.join(source, 'ui.json'), JSON.stringify(document))
  await writeFile(path.join(source, 'editor.html'), `<main style="padding:20px"><h1>文本编辑器</h1><textarea aria-label="文档内容"></textarea><button id="save">保存文档</button><p id="result" role="status"></p></main><script>
    acquireEdenApi().then(async api=>{let revision;const input=document.querySelector('textarea');const loaded=await api.document.read();input.value=loaded.content;revision=loaded.revision;
      const save=async()=>{try{const result=await api.document.save(input.value,revision);revision=result.revision;api.setDirty(false);document.querySelector('#result').textContent='已保存';}catch(error){document.querySelector('#result').textContent=String(error);throw error;}};
      input.oninput=()=>api.setDirty(true);api.registerSave(save);document.querySelector('#save').onclick=()=>save().catch(()=>{});
    }).catch(error=>document.querySelector('#result').textContent=String(error));</script>`)
  await mkdir(workspace); await writeFile(path.join(workspace, 'note.txt'), '磁盘原文')
  web = await pluginBrowserHarness(() => boot, { cacheDir: path.join(root, 'node_modules', '.vite') })
  config = loadConfig({ EDEN_AGENT_DATA_ROOT: path.join(root, 'host'), EDEN_AGENT_PORT: '0', EDEN_AGENT_ALLOWED_ORIGINS: web.origin }, root)
  async function start() {
    host = await startServer(config); host.permissions.setMode('full_access')
    sessionId ??= host.sessions.repository.create('扩展平台浏览器验收', [], null).id
    Object.assign(boot, { token: config.token, baseUrl: `http://127.0.0.1:${host.port}`, workspaceId: config.workspaceId, sessionId })
  }
  await start(); browser = await isolatedBrowser(path.join(root, 'browser'))
  async function navigate() {
    await browser.command('Page.navigate', { url: web.url }); await until(() => browser.evaluate('typeof window.__call === "function"'))
    await browser.evaluate(`window.__disposed=0;window.__lifecycleChannel=new BroadcastChannel(${JSON.stringify(lifecycleChannel)});window.__lifecycleChannel.onmessage=()=>window.__disposed++;`)
  }
  await navigate()
  const call = (method, input) => browser.evaluate(`window.__call(${JSON.stringify(method)},${JSON.stringify(input)})`)
  async function install(directory) {
    const preview = await call('plugin.inspect', { sourceType: 'local', sourceUri: directory })
    await call('plugin.install_preview', { previewID: preview.previewID, activate: true, enabled: false, requireVerified: false })
    await call('plugin.enable', { id: preview.id, enabled: true })
  }
  await call('workspace.switch', { sessionId, path: workspace }); await install(source)
  const text = () => browser.evaluate('document.body.innerText')
  async function click(title) {
    await until(() => browser.evaluate(`Array.from(document.querySelectorAll('button')).some(button=>(button.textContent===${JSON.stringify(title)}||button.getAttribute('aria-label')===${JSON.stringify(title)})&&!button.disabled)`))
    await browser.evaluate(`Array.from(document.querySelectorAll('button')).find(button=>(button.textContent===${JSON.stringify(title)}||button.getAttribute('aria-label')===${JSON.stringify(title)})&&!button.disabled).click()`)
  }
  async function palette(title) {
    await browser.evaluate(`document.querySelector('[aria-label="打开工作台命令"]').click()`)
    await until(() => browser.evaluate('Boolean(document.querySelector("[aria-label=工作台命令]"))'))
    await browser.evaluate(`Array.from(document.querySelectorAll('[role=option]')).find(button=>button.textContent.includes(${JSON.stringify(title)})).click()`)
  }
  const identity = () => call('plugin.ui.list', {}).then(result => result.modules.find(module => module.pluginId === 'platform-browser'))
  async function state(key, namespace = 'storage') {
    const module = await identity()
    return call('plugin.ui.call', { pluginId: module.pluginId, componentId: module.componentId, revision: module.revision, viewId: '$extension', sessionId,
      requestId: crypto.randomUUID(), action: 'extension.state', input: { namespace, scope: 'global', key } })
  }
  await click('我的扩展：检查执行环境')
  await until(async () => (await state('environment')).value?.worker === true)
  checks.push('扩展逻辑真实运行于没有主页面 DOM 的 Worker')
  await click('我的扩展：增加计数'); await until(async () => (await state('count')).value === 1)
  await until(async () => (await text()).includes('计数 1'))
  checks.push('工具栏命令、持久存储和状态栏贯通')
  await browser.command('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 3, key: 'e', code: 'KeyE' })
  await browser.command('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 3, key: 'e', code: 'KeyE' })
  await until(() => frameEval('document.querySelector("#value")?.textContent.includes("1")'))
  checks.push('扩展快捷键打开独立页面并读取真实存储')
  assert.equal(await browser.evaluate(`(()=>{try{document.querySelector('iframe').contentWindow.document.body;return false}catch{return true}})()`), true)
  checks.push('扩展页面不能读取父工作台 DOM')
  await frameEval('document.querySelector("#increment").click()')
  await until(async () => (await state('count')).value === 2)
  checks.push('独立页面通过消息桥调用 Worker 命令且只写入一次')
  await frameEval('document.querySelector("#increment").focus()')
  await browser.command('Input.dispatchKeyEvent', { type:'keyDown',modifiers:3,key:'h',code:'KeyH',windowsVirtualKeyCode:72 })
  await browser.command('Input.dispatchKeyEvent', { type:'keyUp',modifiers:3,key:'h',code:'KeyH',windowsVirtualKeyCode:72 })
  await until(async()=> (await state('environment')).revision===2)
  checks.push('焦点在独立页面时，同一命令的第二个快捷键通过绑定会话执行一次')
  await click('我的扩展：创建真实备忘')
  await until(async () => (await call('memo.page', { limit: 80 })).items.some(item => item.title === '扩展浏览器真实备忘'))
  checks.push('扩展命令经权限和真实宿主工具写入备忘')
  await click('我的扩展：打开数据树')
  await until(async () => (await text()).includes('已保存计数：2'))
  checks.push('原生树形视图从后端存储提供数据')
  await palette('打开扩展设置')
  assert.equal(await browser.evaluate('document.querySelector("[aria-label=扩展设置]").matches(":modal")'), false)
  await until(() => browser.evaluate('Boolean(document.querySelector("[aria-label=问候语]:not(:disabled)"))'))
  await browser.evaluate(`(()=>{const input=document.querySelector('[aria-label=问候语]');input.value='设置已更新';input.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));})()`)
  await until(async () => (await state('greeting', 'configuration')).value === '设置已更新')
  await until(() => browser.evaluate('!document.querySelector("[aria-label=扩展设置]").textContent.includes("正在读写")'))
  await browser.evaluate('document.querySelector("[aria-label=扩展设置] header button").click()')
  await click('我的扩展：打开扩展')
  await frameEval('document.querySelector("#increment").click()')
  await until(() => frameEval('document.querySelector("#value")?.textContent.includes("设置已更新")'))
  checks.push('声明的设置可在工作台修改并由扩展读取')
  secondBrowser = await isolatedBrowser(path.join(root,'second-browser'))
  await secondBrowser.command('Page.navigate',{url:web.url})
  await until(()=>secondBrowser.evaluate('typeof window.__call === "function"'))
  const currentModule = await identity()
  await secondBrowser.evaluate(`window.__call('plugin.ui.call',${JSON.stringify({pluginId:currentModule.pluginId,componentId:currentModule.componentId,revision:currentModule.revision,viewId:'$extension',sessionId,requestId:crypto.randomUUID(),action:'extension.state',input:{scope:'global',namespace:'configuration',key:'greeting',value:'另一窗口的设置'}})})`)
  await until(()=>frameEval('document.querySelector("#value")?.textContent.includes("另一窗口的设置")'))
  assert.deepEqual(secondBrowser.errors,[])
  await secondBrowser.close(); secondBrowser=undefined
  checks.push('第二个独立客户端写入配置后，第一个页面自动收到通知并重新读取，无需重开页面')
  await browser.evaluate('window.__openFile("note.txt")')
  await until(() => frameEval('document.querySelector("textarea")?.value === "磁盘原文"'))
  await frameEval(`(()=>{const input=document.querySelector('textarea');input.value='扩展保存的正文';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();})()`)
  await browser.command('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 's', code: 'KeyS', windowsVirtualKeyCode: 83 })
  await browser.command('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 's', code: 'KeyS', windowsVirtualKeyCode: 83 })
  await until(async () => await readFile(path.join(workspace, 'note.txt'), 'utf8') === '扩展保存的正文')
  checks.push('自定义编辑器实际读写文件，页面内 Ctrl+S 保存并接入未保存状态')
  await writeFile(path.join(workspace, 'note.txt'), '外部修改')
  await frameEval(`(()=>{const input=document.querySelector('textarea');input.value='旧版本覆盖';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#save').click();})()`)
  await until(() => frameEval('document.querySelector("#result")?.textContent !== "已保存"'))
  assert.equal(await readFile(path.join(workspace, 'note.txt'), 'utf8'), '外部修改')
  checks.push('磁盘内容变化后拒绝旧版本覆盖')
  await host.close(); await start(); await navigate()
  assert.equal((await state('count')).value, 3)
  checks.push('完整宿主重启后持久状态恢复')
  await click('我的扩展：阻塞扩展宿主')
  await until(() => browser.evaluate('Boolean(document.querySelector("[data-extension-running=true]"))'))
  assert.ok((await text()).includes('Eden'))
  await click('阻塞扩展宿主 · 取消')
  await until(async () => (await call('plugin.ui.list', {})).modules.length > 0)
  await palette('查看扩展诊断')
  await until(async () => (await text()).includes('扩展未响应取消'))
  checks.push('扩展死循环不阻塞工作台，取消后终止 Worker 并报告故障')
  await click('重启扩展宿主')
  await until(async () => (await text()).includes('执行状态：ready'))
  await browser.evaluate('document.querySelector("[aria-label=扩展诊断] header button").click()')
  await click('我的扩展：增加计数'); await until(async () => (await state('count')).value === 4)
  assert.equal((await text()).includes('Error: 扩展操作已取消'), false)
  checks.push('手动恢复扩展宿主，保留数据且不重放原操作')
  await click('我的扩展：打开扩展')
  await until(() => frameEval('document.querySelector("#value")?.textContent.includes("4")'))
  await mkdir(evidence, { recursive: true })
  await writeFile(path.join(evidence, 'extension-platform-browser.png'), Buffer.from((await browser.command('Page.captureScreenshot')).data, 'base64'))
  await frameEval('location.href="about:blank"')
  await until(async () => (await text()).includes('扩展页面离开获准文档'))
  await click('重新加载页面')
  await until(() => frameEval('document.querySelector("#value")?.textContent.includes("4")'))
  checks.push('页面离开获准文档时撤销消息桥，重新加载只恢复原安装资源')
  await call('plugin.enable', { id: 'platform-browser', enabled: false })
  await until(() => browser.evaluate(`!Array.from(document.querySelectorAll('button')).some(button=>button.getAttribute('aria-label')==='我的扩展：增加计数')`))
  await until(() => browser.evaluate('window.__disposed>0'))
  checks.push('停用同时撤下命令和界面贡献')
  assert.deepEqual(browser.errors, [])
  await mkdir(evidence, { recursive: true })
  const result = { passed: true, checks, browserExceptions: browser.errors, nodeVersion: process.version, data: 'temporary workspace and database; real production workbench, Worker, frame, SDK and RPC; no model calls' }
  await writeFile(path.join(evidence, 'extension-platform-browser.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} catch (error) {
  await mkdir(evidence, { recursive: true })
  await writeFile(path.join(evidence, 'extension-platform-browser.json'), JSON.stringify({ passed: false, checks, error: String(error), surface: await browser?.evaluate('document.body.innerText').catch(() => ''), frame: await frameEval('document.body.innerText').catch(() => ''), browserExceptions: browser?.errors }, null, 2))
  throw error
} finally {
  await secondBrowser?.close(); await browser?.close(); await web?.close(); await host?.close()
  assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir())); assert.ok(path.basename(root).startsWith('eden-extension-browser-'))
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
