import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, transformWithEsbuild } from 'vite'
import { recordedModel } from '@eden/runtime-pi/testing'
import { startServer } from '../../Server/src/bootstrap/container.ts'
import { loadConfig } from '../../Server/src/bootstrap/config.ts'
import { isolatedBrowser, until } from './browser-cdp.mjs'

const agentRoot = fileURLToPath(new URL('../../', import.meta.url))
const root = await mkdtemp(path.join(tmpdir(), 'eden-ui-browser-'))
let host, vite, browser, model
const frameSessions = new Map()
async function widgetEval(kind, expression) {
  const targets = (await browser.command('Target.getTargets')).targetInfos.filter(target => target.type === 'iframe')
  for (const target of targets) {
    try {
      if (!frameSessions.has(target.targetId)) frameSessions.set(target.targetId, (await browser.command('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId)
      const session = frameSessions.get(target.targetId)
      const match = await browser.command('Runtime.evaluate', { expression: 'Boolean(document.querySelector(' + JSON.stringify('[data-widget=' + kind + ']') + '))', returnByValue: true }, session)
      if (!match.result.value) continue
      const result = await browser.command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session)
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
      return result.result.value
    } catch (error) { if (!/No target|Session closed|Cannot find context|Inspected target navigated/.test(String(error))) throw error }
  }
}
try {
  const sourceDirectory = path.join(root, 'widget'), workspace = path.join(root, 'workspace')
  await mkdir(sourceDirectory); await mkdir(workspace)
  await writeFile(path.join(workspace, 'note.txt'), 'BROWSER_REAL_WORKSPACE')
  const manifest = { schemaVersion: 1, id: 'browser-widget', name: '界面联调工具', description: '真实浏览器交互验收', version: '1.0.0',
    components: { ui: [{ id: 'main', entry: 'ui.json', enabledByDefault: true }] } }
  const document = { schemaVersion: 1, type: 'module', apiVersion: 1, entry: 'client.js', views: [
    { id: 'panel', title: '会话工具面板', slot: 'sidebar_panel' },
    { id: 'page', title: '独立工具页面', slot: 'page' },
    { id: 'card', title: '工具扩展', slot: 'tool_card', toolNames: ['read_file'] },
  ], capabilities: { sessionRead: true, sessionSend: true, tools: ['read_file'] } }
  const widgetSource = version => `export function activate(api) {
    api.addStyle('.ui-browser-widget { padding: 20px; } .ui-browser-widget button { margin: 8px 8px 8px 0; padding: 8px 12px; border: 1px solid currentColor; border-radius: 8px; }');
    const R = api.React;
    function Widget({host, tool}) {
      const [result, setResult] = R.useState('准备就绪 ${version}');
      const [count, setCount] = R.useState(0);
      async function invoke(kind) { try {
        const value = kind === 'session' ? await host.readSession() : kind === 'send' ? await host.sendMessage('来自浏览器界面的消息')
          : await host.callTool('read_file', {path: 'note.txt'});
        setResult(JSON.stringify(value));
      } catch (error) { setResult('ERROR: ' + error.message); } }
      return R.createElement('div', {className:'ui-browser-widget', 'data-widget':tool ? 'card' : 'view'},
        R.createElement('h3', null, '交互工具 ${version}'),
        R.createElement('button', {'data-action':'count', onClick:()=>setCount(count+1)}, '计数 ' + count),
        R.createElement('button', {'data-action':'session', onClick:()=>invoke('session')}, '读取会话'),
        R.createElement('button', {'data-action':'file', onClick:()=>invoke('file')}, '读取工作区'),
        R.createElement('button', {'data-action':'send', onClick:()=>invoke('send')}, '发送消息'),
        R.createElement('p', {'data-result':true}, result));
    }
    for (const id of ['panel','page','card']) api.registerView(id, Widget);
  }`
  await writeFile(path.join(sourceDirectory, 'plugin.json'), JSON.stringify(manifest))
  await writeFile(path.join(sourceDirectory, 'ui.json'), JSON.stringify(document))
  await writeFile(path.join(sourceDirectory, 'client.js'), widgetSource('v1'))
  let boot = {}
  const harness = {
    name: 'plugin-ui-smoke-harness',
    resolveId(id) { if (id === '/__ui_harness.tsx') return '\0__ui_harness.tsx' },
    async load(id) {
      if (id !== '\0__ui_harness.tsx') return
      const source = `import React from 'react'; import {createRoot} from 'react-dom/client';
        import '/src/index.css';
        import {PluginUiProvider} from '/src/components/plugin-ui/PluginUiProvider.tsx';
        import {PluginUiLauncher} from '/src/components/plugin-ui/PluginUiLauncher.tsx';
        import {ToolCard} from '/src/components/chat/message/ToolCard.tsx';
        import {rpcRequestForOrigin} from '/src/lib/rpc-transport.ts';
        localStorage.setItem('agent.runtime_origin','local');
        window.edenAgentDesktop = {getAgentCapability:async()=>(${JSON.stringify(boot)})};
        window.__call = (method,params)=>rpcRequestForOrigin('local',method,params);
        createRoot(document.getElementById('root')).render(<React.StrictMode>
          <PluginUiProvider origin="local" enabled sessionId=${JSON.stringify(boot.sessionId)}>
            <div style={{minHeight:'100vh',padding:32,background:'var(--color-bg)',color:'var(--color-text)'}}>
              <h1>应用扩展交互验收</h1><PluginUiLauncher/>
              <div style={{width:'55%',marginTop:32}}><ToolCard tool={{id:'fixture-read',name:'read_file',status:'success',input:'{"path":"note.txt"}',output:'fixture output'}}/></div>
            </div>
          </PluginUiProvider></React.StrictMode>);`
      return transformWithEsbuild(source, 'ui-harness.tsx', { loader: 'tsx', jsx: 'automatic' })
    },
    configureServer(server) {
      server.middlewares.use('/__ui_smoke', async (_request, response) => {
        response.setHeader('Content-Type', 'text/html')
        response.end(await server.transformIndexHtml('/__ui_smoke', '<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module" src="/__ui_harness.tsx"></script></body></html>'))
      })
    },
  }
  vite = await createServer({ root: path.join(agentRoot, 'frontend/web'), configFile: path.join(agentRoot, 'frontend/web/vite.config.ts'), cacheDir:path.join(root,'node_modules','.vite'),
    plugins: [harness], server: { host: '127.0.0.1', port: 0, strictPort: false, open: false } })
  await vite.listen()
  const webUrl = `http://127.0.0.1:${vite.httpServer.address().port}`
  model = await recordedModel([{ text: '浏览器消息已收到' }])
  const config = { ...loadConfig({ EDEN_AGENT_DATA_ROOT: path.join(root, 'data'), EDEN_AGENT_PORT: '0',
    EDEN_AGENT_ALLOWED_ORIGINS: webUrl }, root), model: model.config }
  host = await startServer(config)
  host.permissions.setMode('full_access')
  const session = host.sessions.repository.create('浏览器真实会话', [], null)
  boot = { token: config.token, baseUrl: `http://127.0.0.1:${host.port}`, sessionId: session.id, workspaceId: config.workspaceId }
  browser = await isolatedBrowser(path.join(root, 'browser'))
  await browser.command('Page.navigate', { url: `${webUrl}/__ui_smoke` })
  await until(() => browser.evaluate('typeof window.__call === "function"'))
  const call = (method, input) => browser.evaluate(`window.__call(${JSON.stringify(method)},${JSON.stringify(input)})`)
  await call('workspace.switch', { sessionId: session.id, path: workspace })
  async function install() {
    const preview = await call('plugin.inspect', { sourceType: 'local', sourceUri: sourceDirectory })
    await call('plugin.install_preview', { previewID: preview.previewID, activate: true, enabled: false, requireVerified: false })
    await call('plugin.enable', { id: 'browser-widget', enabled: true })
  }
  await install()
  await until(() => widgetEval('card','document.querySelectorAll("[data-widget=card]").length === 1'))
  await widgetEval('card','document.querySelector("[data-widget=card] [data-action=count]").click()')
  await until(() => widgetEval('card','document.querySelector("[data-widget=card] [data-action=count]").textContent === "计数 1"'))
  await browser.evaluate('document.querySelector("[aria-label=打开应用扩展]").click()')
  await until(() => browser.evaluate('[...document.querySelectorAll("nav button")].some(e=>e.textContent.includes("会话工具面板"))'))
  await browser.evaluate('[...document.querySelectorAll("nav button")].find(e=>e.textContent.includes("会话工具面板")).click()')
  await until(() => widgetEval('view','Boolean(document.querySelector("[data-widget=view]"))'))
  await widgetEval('view','document.querySelector("[data-action=session]").click()')
  await until(() => widgetEval('view','document.querySelector("[data-result]").textContent.includes("浏览器真实会话")'))
  await widgetEval('view','document.querySelector("[data-action=file]").click()')
  await until(() => widgetEval('view','document.querySelector("[data-result]").textContent.includes("BROWSER_REAL_WORKSPACE")'))
  const screenshot = await browser.command('Page.captureScreenshot', { format: 'png' })
  const evidence = path.resolve(agentRoot, '../.run/logs')
  await mkdir(evidence, { recursive: true })
  await writeFile(path.join(evidence, 'plugin-ui-browser.png'), Buffer.from(screenshot.data, 'base64'))
  await widgetEval('view','document.querySelector("[data-action=send]").click()')
  await host.sessions.waitForIdle(session.id)
  await until(() => model.requests.length === 1)
  assert.match(JSON.stringify(model.requests[0].messages), /来自浏览器界面的消息/)
  await browser.evaluate('document.querySelector("[aria-label=关闭扩展面板]").click(); document.querySelector("[aria-label=打开应用扩展]").click()')
  await until(() => browser.evaluate('[...document.querySelectorAll("nav button")].some(e=>e.textContent.includes("独立工具页面"))'))
  await browser.evaluate('[...document.querySelectorAll("nav button")].find(e=>e.textContent.includes("独立工具页面")).click()')
  await until(() => browser.evaluate('Boolean(document.querySelector("[aria-label=返回聊天]"))'))
  await browser.evaluate('document.querySelector("[aria-label=返回聊天]").click()')
  await writeFile(path.join(sourceDirectory, 'client.js'), widgetSource('v2'))
  await install()
  await until(() => widgetEval('card','document.querySelector("[data-widget=card]")?.textContent.includes("交互工具 v2")'))
  assert.equal(await browser.evaluate('document.querySelectorAll("style[data-eden-plugin-ui]").length'), 0)
  assert.equal(await widgetEval('card', '(()=>{try{return Boolean(parent.document.body)}catch{return false}})()'), false)
  await writeFile(path.join(sourceDirectory, 'client.js'), 'export function activate(api) { api.registerView("undeclared", () => null); }')
  await install()
  await until(() => browser.evaluate('document.body.innerText.includes("未声明或重复的插件视图")'))
  await writeFile(path.join(sourceDirectory, 'client.js'), widgetSource('v3')); await install()
  await until(() => widgetEval('card', 'document.body.innerText.includes("交互工具 v3")'))
  await widgetEval('card', 'onmessage=event=>{if(event.data==="eden-test-hang"){while(true){}}}; true')
  await browser.evaluate('document.querySelector("iframe").contentWindow.postMessage("eden-test-hang","*"); true')
  await new Promise(resolve => setTimeout(resolve, 200))
  assert.equal(await browser.evaluate('1+1'), 2)
  await call('plugin.enable', { id: 'browser-widget', enabled: false })
  await until(() => browser.evaluate('document.querySelectorAll("iframe").length === 0 && document.querySelectorAll("style[data-eden-plugin-ui]").length === 0'))
  assert.deepEqual(browser.errors, [])
  const summary = { checks: ['StrictMode 模块加载', '工具卡片交互', '侧边面板', '真实会话读取', '真实工作区工具调用',
    '正常消息输入', '独立页面与返回', '版本热替换', '旧版样式和 DOM 隔离', '旧版激活失败及版本恢复', '旧版死循环不阻塞工作台', '停用清理'], passed: true, browserExceptions: browser.errors }
  await writeFile(path.join(evidence, 'plugin-ui-browser.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary))
} catch (error) {
  const evidence = path.resolve(agentRoot, '../.run/logs')
  await mkdir(evidence, { recursive: true })
  await writeFile(path.join(evidence, 'plugin-ui-browser.json'), JSON.stringify({ passed: false, error: String(error), browserExceptions: browser?.errors }, null, 2))
  throw error
} finally {
  await browser?.close()
  await vite?.close()
  await host?.close()
  await model?.close()
  if (!path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('Unexpected browser test cleanup root')
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
