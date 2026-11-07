import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {startServer} from '../../Server/src/bootstrap/container.ts'
import {loadConfig} from '../../Server/src/bootstrap/config.ts'
import {pluginBrowserHarness} from './plugin-browser-harness.mjs'
import {isolatedBrowser,until} from './browser-cdp.mjs'
import {pluginNativeBrowser} from './plugin-native-browser.mjs'

const native=process.env.EDEN_PRESENTATION_ELECTRON==='1',root=await mkdtemp(path.join(tmpdir(),'eden-presentations-'))
const source=path.join(root,'source'),evidence=fileURLToPath(new URL('../../../.run/logs/',import.meta.url)),boot={},checks=[]
const reportName='extension-presentations-'+(native?'electron':'browser')
const definitions=[['workspace','工作区示例','page'],['side','侧栏示例','sidebar_panel'],['bottom','底部示例','bottom_panel'],['full','独占示例','full_page'],['floating','浮动示例','floating_window'],['card','卡片示例','tool_card']]
const titles=Object.fromEntries(definitions.map(([id,title])=>[id,title])),sessions=new Map()
let browser,web,host,sessionId
async function targetEval(target,expression,userGesture=false){
  if(!sessions.has(target.targetId))sessions.set(target.targetId,(await browser.command('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId)
  const result=await browser.command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture},sessions.get(target.targetId))
  if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text)
  return result.result.value
}
async function frame(id,expression,userGesture=false){
  const targets=(await browser.command('Target.getTargets')).targetInfos.filter(target=>target.type==='iframe')
  for(const target of targets)try{
    if(await targetEval(target,`Boolean(document.querySelector('[data-view=${id}]'))`))return await targetEval(target,expression,userGesture)
  }catch(error){if(!/No target|Session closed|Cannot find context|Inspected target navigated/.test(String(error)))throw error}
}
async function click(label){
  await until(()=>browser.evaluate(`Array.from(document.querySelectorAll('button')).some(button=>button.getAttribute('aria-label')===${JSON.stringify(label)}&&!button.disabled)`))
  const result=await browser.command('Runtime.evaluate',{expression:`Array.from(document.querySelectorAll('button')).find(button=>button.getAttribute('aria-label')===${JSON.stringify(label)}).click()`,returnByValue:true,userGesture:true})
  if(result.exceptionDetails)throw Error(result.exceptionDetails.text)
}
try{
  await mkdir(source)
  const views=definitions.map(([id,title,slot])=>({id,title,slot,...(id==='side'?{renderer:'tree'}:{renderer:'webview',entry:id+'.html'}),...(id==='card'?{toolNames:['read_file']}:{})}))
  await writeFile(path.join(source,'plugin.json'),JSON.stringify({schemaVersion:1,id:'presentation-test',name:'展示验收插件',description:'Temporary presentation acceptance',version:'1.0.0',components:{ui:[{id:'main',entry:'ui.json',enabledByDefault:true}]}}))
  const commands=definitions.filter(([id])=>id!=='card').map(([id,title])=>({id:'open-'+id,title:'打开'+title}))
  await writeFile(path.join(source,'ui.json'),JSON.stringify({schemaVersion:1,type:'module',apiVersion:2,entry:'extension.js',views,contributes:{commands,menus:commands.map(command=>({command:command.id,location:'toolbar'}))}}))
  await writeFile(path.join(source,'extension.js'),`export function activate(api){
    for(const id of ['workspace','side','bottom','full','floating'])api.registerCommand('open-'+id,context=>context.openView(id));
    api.registerTreeDataProvider('side',()=>[{id:'side-node',label:'侧栏原生树数据'}]);
    for(const id of ['workspace','bottom','full','floating','card'])api.registerWebviewMessageHandler(id,async(context,message)=>{
      if(message?.operation==='open-full')return context.openView('full');
      if(message?.operation==='save'){await context.storage('global').update(id,message.value);await context.storage('global').update('last-session',context.sessionId);}
      return (await context.storage('global').get(id)).value;
    });
  }`)
  for(const [id,title]of definitions)if(id!=='side')await writeFile(path.join(source,id+'.html'),`<main data-view="${id}" style="padding:16px"><h1>${title}</h1><input aria-label="扩展草稿"><p id="saved"></p></main><script>
    acquireEdenApi().then(async api=>{window.__api=api;const input=document.querySelector('input'),stored=await api.request('message',{});input.value=api.getState()?.draft??stored??'';
      input.oninput=()=>{api.setState({draft:input.value});api.setDirty(true)};
      api.registerSave(async()=>{await api.request('message',{message:{operation:'save',value:input.value}});api.setDirty(false);document.querySelector('#saved').textContent='已保存'});
    }).catch(error=>document.querySelector('#saved').textContent=String(error));</script>`)
  web=await pluginBrowserHarness(()=>boot,{presentations:true,cacheDir:path.join(root,'node_modules','.vite')})
  const config=loadConfig({EDEN_AGENT_DATA_ROOT:path.join(root,'data'),EDEN_AGENT_PORT:'0',EDEN_AGENT_ALLOWED_ORIGINS:web.origin},root)
  host=await startServer(config);host.permissions.setMode('full_access')
  sessionId=host.sessions.repository.create('展示类型验收',[],null).id
  const secondSessionId=host.sessions.repository.create('另一会话',[],null).id
  Object.assign(boot,{token:config.token,baseUrl:`http://127.0.0.1:${host.port}`,workspaceId:config.workspaceId,sessionId,secondSessionId})
  browser=native?await pluginNativeBrowser(path.join(root,'native'),web.url):await isolatedBrowser(path.join(root,'browser'))
  if(!native)await browser.command('Page.navigate',{url:web.url})
  await until(()=>browser.evaluate('Boolean(document.querySelector("[aria-label=展示验收草稿]"))'),60000)
  await browser.evaluate('window.__chatNode=document.querySelector("[aria-label=展示验收草稿]");window.__chatNode.focus()')
  await browser.command('Input.insertText',{text:'保持原聊天草稿'})
  const call=(method,input)=>browser.evaluate(`window.__call(${JSON.stringify(method)},${JSON.stringify(input)})`)
  const preview=await call('plugin.inspect',{sourceType:'local',sourceUri:source})
  await call('plugin.install_preview',{previewID:preview.previewID,activate:true,enabled:false,requireVerified:false});await call('plugin.enable',{id:preview.id,enabled:true})
  const initial=await browser.evaluate('window.__presentationState')
  const open=id=>click('展示验收插件：打开'+titles[id])
  const state=()=>browser.evaluate('window.__presentationState')
  await open('side');await until(()=>browser.evaluate('document.querySelector(".workbench-tool-sidebar")?.textContent.includes("侧栏原生树数据")'))
  assert.equal((await state()).tabs.find(tab=>tab.kind==='chat').group,'main')
  assert.equal(await browser.evaluate('document.querySelector("[aria-label=展示验收草稿]")===window.__chatNode'),true)
  checks.push('sidebar_panel 原生树默认落入工具侧栏，聊天实例及位置保持不变')
  await open('bottom');await until(()=>frame('bottom','Boolean(window.__api)'))
  assert.equal((await state()).tabs.find(tab=>tab.slot==='bottom_panel').group,'panel')
  assert.equal(await browser.evaluate('Math.abs(document.querySelector(".workbench-shell").getBoundingClientRect().height-innerHeight)<1'),true)
  assert.ok(await browser.evaluate('document.querySelector("[data-group-id=main] .workbench-group-content").getBoundingClientRect().height>200'))
  checks.push('bottom_panel 默认打开底部工具面板，保留聊天主区的可用高度')
  await mkdir(evidence,{recursive:true});if(!native)await writeFile(path.join(evidence,reportName+'-docked.png'),Buffer.from((await browser.command('Page.captureScreenshot')).data,'base64'))
  await open('full');await until(()=>frame('full','Boolean(window.__api)'))
  assert.equal(await browser.evaluate(`(()=>{const r=document.querySelector('[data-plugin-full-page]:not([hidden])').getBoundingClientRect();return r.x===0&&r.y===0&&r.width===innerWidth&&r.height===innerHeight})()`),true)
  await browser.evaluate('window.__fullFrame=document.querySelector("[data-plugin-full-page] iframe");true')
  if(!native)await writeFile(path.join(evidence,reportName+'-full.png'),Buffer.from((await browser.command('Page.captureScreenshot')).data,'base64'))
  await frame('full',`(()=>{const input=document.querySelector('input');input.value='独占页未保存草稿';input.dispatchEvent(new Event('input',{bubbles:true}))})()`,true)
  await until(()=>browser.evaluate('document.querySelector("[data-plugin-full-page]").textContent.includes("未保存")'))
  await browser.evaluate('Array.from(document.querySelectorAll("[data-plugin-full-page] button")).find(button=>button.textContent==="返回工作台").click()')
  assert.equal((await state()).active.application,null)
  await open('full');await until(()=>browser.evaluate('Boolean(document.querySelector("[data-plugin-full-page]:not([hidden])"))'))
  assert.equal(await browser.evaluate('document.querySelector("[data-plugin-full-page] iframe")===window.__fullFrame'),true)
  assert.equal(await frame('full','document.querySelector("input").value'),'独占页未保存草稿')
  checks.push('full_page 独占整个窗口，返回及重开保留同一界面实例和草稿')
  await browser.evaluate(`Array.from(document.querySelectorAll('[data-plugin-full-page] button')).find(button=>button.getAttribute('aria-label')?.startsWith('关闭独占页面')).click()`)
  await until(()=>browser.evaluate('Boolean(document.querySelector("[aria-label=关闭未保存页面][open]"))'))
  await browser.evaluate('Array.from(document.querySelectorAll("[aria-label=关闭未保存页面] button")).find(button=>button.textContent==="取消").click()')
  await browser.evaluate('Array.from(document.querySelectorAll("[data-plugin-full-page] button")).find(button=>button.textContent==="保存").click()')
  await until(()=>frame('full','document.querySelector("#saved").textContent==="已保存"'))
  await browser.evaluate(`Array.from(document.querySelectorAll('[data-plugin-full-page] button')).find(button=>button.getAttribute('aria-label')?.startsWith('关闭独占页面')).click()`)
  await until(()=>browser.evaluate('!document.querySelector("[data-plugin-full-page]")'))
  checks.push('独占页关闭遵守未保存确认，真实后端保存后可正常关闭')
  // Only force the browser popup-denial boundary, then restore it before testing a real window.
  await browser.evaluate('window.__originalOpen=window.open;window.open=()=>null;true')
  await open('floating')
  await until(()=>browser.evaluate('document.body.innerText.includes("无法打开浮动窗口")'))
  await browser.evaluate('window.open=window.__originalOpen;true')
  const reopened=await browser.command('Runtime.evaluate',{expression:'Array.from(document.querySelectorAll("button")).find(button=>button.textContent==="打开浮动窗口").click();true',returnByValue:true,userGesture:true})
  if(reopened.exceptionDetails)throw Error(reopened.exceptionDetails.text)
  await until(()=>frame('floating','Boolean(window.__api)'))
  checks.push('弹窗被拦截时提供重开入口，恢复后由用户点击创建真实窗口')
  const popup=(await browser.command('Target.getTargets')).targetInfos.find(target=>target.type==='page'&&target.url.endsWith('/extension-window.html'))
  assert.ok(popup)
  assert.equal(await targetEval(popup,'typeof window.edenAgentDesktop'),'undefined')
  assert.equal(await frame('floating','(()=>{try{return Boolean(parent.document.body)}catch{return false}})()'),false)
  if(!native){await browser.command('Page.enable',{},sessions.get(popup.targetId));await writeFile(path.join(evidence,reportName+'-floating.png'),Buffer.from((await browser.command('Page.captureScreenshot',{},sessions.get(popup.targetId))).data,'base64'))}
  checks.push('floating_window 创建独立窗口，不注入桌面桥，扩展仍不能读取宿主 DOM')
  await frame('floating',`(()=>{const input=document.querySelector('input');input.value='浮动窗口真实保存';input.dispatchEvent(new Event('input',{bubbles:true}))})()`,true)
  await until(()=>targetEval(popup,'Boolean(Array.from(document.querySelectorAll("button")).find(button=>button.textContent==="保存"))'))
  if(native)await targetEval(popup,'window.close();true',true)
  else await targetEval(popup,'Array.from(document.querySelectorAll("button")).find(button=>button.textContent==="关闭窗口").click();true',true)
  await until(()=>browser.evaluate('Boolean(document.querySelector("[aria-label=关闭未保存页面][open]"))'))
  assert.ok((await browser.command('Target.getTargets')).targetInfos.some(target=>target.targetId===popup.targetId))
  await browser.evaluate('Array.from(document.querySelectorAll("[aria-label=关闭未保存页面] button")).find(button=>button.textContent==="取消").click()')
  await targetEval(popup,'Array.from(document.querySelectorAll("button")).find(button=>button.textContent==="保存").click();true',true)
  await until(()=>frame('floating','document.querySelector("#saved").textContent==="已保存"'))
  const module=(await call('plugin.ui.list',{})).modules[0]
  const saved=await call('plugin.ui.call',{pluginId:module.pluginId,componentId:module.componentId,revision:module.revision,viewId:'floating',sessionId,requestId:crypto.randomUUID(),action:'extension.state',input:{scope:'global',namespace:'storage',key:'floating'}})
  assert.equal(saved.value,'浮动窗口真实保存')
  const bound=await call('plugin.ui.call',{pluginId:module.pluginId,componentId:module.componentId,revision:module.revision,viewId:'floating',sessionId,requestId:crypto.randomUUID(),action:'extension.state',input:{scope:'global',namespace:'storage',key:'last-session'}})
  assert.equal(bound.value,sessionId)
  checks.push('浮动窗口关闭可取消，保存经原会话和真实 SQLite 完成')
  await browser.evaluate('window.__openPresentationSession(window.__testBoot.secondSessionId)')
  await until(()=>browser.evaluate('window.__presentationSession===window.__testBoot.secondSessionId'))
  await frame('floating',`window.__api.request('message',{message:{operation:'open-full'}})`)
  await until(()=>browser.evaluate('window.__presentationSession===window.__testBoot.sessionId'))
  const focusedState=await state();assert.equal(focusedState.tabs.find(tab=>tab.id===focusedState.active.application)?.sessionId,sessionId)
  await browser.evaluate('Array.from(document.querySelectorAll("[data-plugin-full-page]:not([hidden]) button")).find(button=>button.textContent==="返回工作台").click()')
  await until(()=>browser.evaluate('window.__presentationSession===window.__testBoot.secondSessionId'))
  checks.push('主窗口切换聊天后，浮动窗口 SDK 打开独占页仍绑定原会话，返回恢复主窗口聊天')
  await open('workspace');await until(()=>frame('workspace','Boolean(window.__api)'))
  assert.equal((await state()).tabs.find(tab=>tab.kind==='chat').group,'main')
  assert.deepEqual((await state()).layout,initial.layout)
  checks.push('普通 page 保持可分屏工作区行为，任何类型都不搬动聊天或改写分屏')
  assert.ok(await frame('card','Boolean(window.__api)'))
  checks.push('tool_card 继续嵌入宿主工具结果卡片（工具记录为合成夹具）')
  await open('full');await until(()=>frame('full','Boolean(window.__api)'))
  await call('plugin.enable',{id:'presentation-test',enabled:false})
  await until(()=>browser.evaluate('!document.querySelector("[data-plugin-full-page]")'))
  await until(async()=>!(await browser.command('Target.getTargets')).targetInfos.some(target=>target.targetId===popup.targetId))
  assert.equal(await browser.evaluate('window.__chatNode.value'),'保持原聊天草稿')
  checks.push('停用关闭独占页及浮动窗口，保留聊天草稿和布局')
  assert.deepEqual(browser.errors,[])
  await mkdir(evidence,{recursive:true})
  if(!native)await writeFile(path.join(evidence,reportName+'.png'),Buffer.from((await browser.command('Page.captureScreenshot')).data,'base64'))
  const result={passed:true,nativeElectron:native,checks,browserExceptions:browser.errors,data:'Temporary profile/database; production SDK, renderer, workbench hook, native window policy and empty preload; fixture draft editor/tool record; no model calls'}
  await writeFile(path.join(evidence,reportName+'.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
}catch(error){
  await mkdir(evidence,{recursive:true});await writeFile(path.join(evidence,reportName+'.json'),JSON.stringify({passed:false,checks,error:String(error),browserExceptions:browser?.errors,surface:await browser?.evaluate('document.body.innerText').catch(()=>''),state:await browser?.evaluate('window.__presentationState').catch(()=>null),scripts:await browser?.evaluate('Array.from(document.scripts).map(script=>script.src)').catch(()=>null)},null,2));throw error
}finally{
  await browser?.close();await web?.close();await host?.close()
  assert.equal(path.dirname(root),tmpdir());assert.ok(path.basename(root).startsWith('eden-presentations-'))
  await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100})
}
