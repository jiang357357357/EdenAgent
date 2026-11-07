import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../../Server/src/bootstrap/container.ts'
import { loadConfig } from '../../Server/src/bootstrap/config.ts'
import { pluginBrowserHarness } from './plugin-browser-harness.mjs'
import { isolatedBrowser, until } from './browser-cdp.mjs'

const root=await mkdtemp(path.join(tmpdir(),'eden-application-pages-'))
const evidence=fileURLToPath(new URL('../../../.run/logs/',import.meta.url)),checks=[],boot={}
let web,host,browser
try {
  web=await pluginBrowserHarness(()=>boot,{applicationPages:true,cacheDir:path.join(root,'node_modules','.vite')})
  const config=loadConfig({EDEN_AGENT_DATA_ROOT:path.join(root,'data'),EDEN_AGENT_PORT:'0',EDEN_AGENT_ALLOWED_ORIGINS:web.origin},root)
  host=await startServer(config);host.permissions.setMode('full_access')
  const session=host.sessions.repository.create('整页布局验收',[],null)
  Object.assign(boot,{token:config.token,baseUrl:`http://127.0.0.1:${host.port}`,workspaceId:config.workspaceId,sessionId:session.id})
  browser=await isolatedBrowser(path.join(root,'browser'))
  await browser.command('Page.navigate',{url:web.url})
  await until(()=>browser.evaluate('Boolean(document.querySelector("textarea[aria-label=布局验收草稿]"))'))
  async function command(title) {
    await browser.evaluate('document.querySelector("[aria-label=打开工作台命令]").click()')
    await until(()=>browser.evaluate('Boolean(document.querySelector("[aria-label=工作台命令][open]"))'))
    await browser.evaluate(`Array.from(document.querySelectorAll('[role=option]')).find(element=>element.querySelector('span')?.textContent===${JSON.stringify(title)}).click()`)
  }
  await command('向右拆分编辑组')
  await browser.evaluate('window.__draftNode=document.querySelector("textarea[aria-label=布局验收草稿]");window.__draftNode.focus()')
  await browser.command('Input.insertText',{text:'尚未保存的聊天草稿'})
  const before=await browser.evaluate('JSON.stringify(window.__applicationWorkbench)')
  checks.push('预先建立聊天分屏及未保存草稿')
  await browser.evaluate('Array.from(document.querySelectorAll("button")).find(button=>button.textContent==="打开自醒").click()')
  await until(()=>browser.evaluate('Boolean(document.querySelector("[data-application-page=selfAwake] h1"))'))
  await until(()=>browser.evaluate(`(()=>{const page=document.querySelector('[data-application-page=selfAwake] .theme-page'),r=page.getBoundingClientRect();return Math.abs(r.x)<1&&Math.abs(r.y)<1&&Math.abs(r.width-innerWidth)<1&&Math.abs(r.height-innerHeight)<1})()`))
  assert.equal(await browser.evaluate('document.querySelector("[data-application-workbench]").hidden && document.querySelector("[data-application-workbench]").inert'),true)
  assert.equal(await browser.evaluate('document.querySelector("[data-application-page=selfAwake]").closest(".workbench-surface")===null'),true)
  assert.equal(await browser.evaluate('window.__applicationWorkbench.tabs.some(tab=>tab.page==="selfAwake")'),false)
  checks.push('真实自醒页面独占整个视口，工作台隐藏且不可交互，不创建可拆分标签')
  await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:'\\',code:'Backslash',modifiers:2})
  await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'\\',code:'Backslash',modifiers:2})
  assert.equal(await browser.evaluate('JSON.stringify(window.__applicationWorkbench)'),before)
  checks.push('应用页面显示期间，工作台快捷键不能修改后台布局')
  await browser.evaluate('document.querySelector("[data-application-page] [aria-label=返回聊天]").click()')
  await until(()=>browser.evaluate('!document.querySelector("[data-application-workbench]").hidden'))
  assert.equal(await browser.evaluate('document.querySelector("textarea[aria-label=布局验收草稿]")===window.__draftNode'),true)
  assert.equal(await browser.evaluate('window.__draftNode.value'),'尚未保存的聊天草稿')
  assert.equal(await browser.evaluate('JSON.stringify(window.__applicationWorkbench)'),before)
  checks.push('返回聊天保留同一编辑器实例、未保存草稿及原分屏布局')
  await command('打开：自醒')
  await until(()=>browser.evaluate('Boolean(document.querySelector("[data-application-page=selfAwake] h1"))'))
  assert.equal(await browser.evaluate('JSON.stringify(window.__applicationWorkbench)'),before)
  checks.push('命令面板通过应用导航打开自醒，不向工作台插入文档')
  await mkdir(evidence,{recursive:true})
  await writeFile(path.join(evidence,'application-pages-browser.png'),Buffer.from((await browser.command('Page.captureScreenshot')).data,'base64'))
  await browser.command('Emulation.setDeviceMetricsOverride',{width:800,height:600,deviceScaleFactor:1,mobile:false})
  await until(()=>browser.evaluate('document.querySelector("[data-application-page]").getBoundingClientRect().width===800'))
  checks.push('缩窄窗口后应用页面继续独占视口')
  await browser.evaluate(`(()=>{const key=Object.keys(localStorage).find(key=>key.startsWith('eden.workbench:'));const state=JSON.parse(localStorage.getItem(key));state.tabs.push({id:'page:selfAwake',kind:'page',page:'selfAwake',title:'自醒',group:'panel'});state.active.panel='page:selfAwake';localStorage.setItem(key,JSON.stringify(state));})()`)
  await browser.evaluate('window.__awaitingApplicationReload=true')
  await browser.command('Page.reload')
  await until(()=>browser.evaluate('!window.__awaitingApplicationReload && Boolean(window.__applicationWorkbench?.tabs.some(tab=>tab.kind==="chat"))'))
  assert.equal(await browser.evaluate('window.__applicationWorkbench.tabs.some(tab=>tab.page==="selfAwake")'),false)
  assert.deepEqual(await browser.evaluate('window.__applicationWorkbench.layout'),JSON.parse(before).layout)
  checks.push('重新加载时清理旧版误存的自醒标签，同时保留原聊天分屏')
  assert.deepEqual(browser.errors,[])
  const result={passed:true,checks,browserExceptions:browser.errors,data:'Temporary database/profile; production SelfAwakePage, application navigation, workbench hook and renderer; fixture draft editor only'}
  await writeFile(path.join(evidence,'application-pages-browser.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
} catch(error) {
  await mkdir(evidence,{recursive:true})
  await writeFile(path.join(evidence,'application-pages-browser.json'),JSON.stringify({passed:false,checks,error:String(error),browserExceptions:browser?.errors},null,2));throw error
} finally {
  await browser?.close();await web?.close();await host?.close()
  assert.equal(path.dirname(root),tmpdir());assert.ok(path.basename(root).startsWith('eden-application-pages-'))
  await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100})
}
