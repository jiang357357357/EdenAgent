import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const logs=fileURLToPath(new URL('../../../.run/logs/',import.meta.url))
const driver=JSON.parse(await readFile(logs+'/plugin-desktop-driver.json','utf8'))
const checks=[]
async function send(command){const response=await fetch(driver.url,{method:'POST',body:JSON.stringify(command),signal:AbortSignal.timeout(45000)});const value=await response.json();if(!response.ok)throw Error(value.error);return value.result}
const evaluate=expression=>send({action:'evaluate',expression})
const pause=()=>new Promise(resolve=>setTimeout(resolve,220))
async function until(expression){for(let n=0;n<80;n++){if(await evaluate(expression))return;await pause()}throw Error('Timed out: '+expression)}
const layout=async()=>{await pause();return evaluate(`JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('eden.workbench:')&&k.endsWith(']'))))`)}
async function menu(){await send({action:'click',name:'角色'});await until(`!!document.querySelector('[role=menu][aria-label="角色菜单"]:popover-open')`)}
async function item(label){await evaluate(`(()=>{const b=[...document.querySelector('[aria-label="角色菜单"]').querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')||b.textContent)===${JSON.stringify(label)});if(!b)throw Error('Missing role action');b.click()})()`);await pause()}
async function activate(id){await evaluate(`document.getElementById(${JSON.stringify('wb-tab-'+encodeURIComponent(id))}).click()`);await pause()}
const heading=label=>`[...document.querySelectorAll('.workbench-surface:not([hidden]) h2')].some(e=>e.textContent===${JSON.stringify(label)})`
try{
  assert.ok(driver.root.includes('eden-plugin-desktop-'))
  await until(`!!document.querySelector('.workbench-shell')`)
  await send({action:'viewport',width:1536,height:780})
  const original=await layout(),ledger=original.tabs.find(tab=>tab.kind==='plugin'&&tab.viewKey.startsWith('chat-ledger/'))
  const characterBefore=await evaluate(`(async()=>JSON.stringify((await window.edenAgentDesktop.invoke('get_local_runtime_config')).character))()`)
  await menu()
  assert.deepEqual(await evaluate(`[...document.querySelector('[aria-label="角色菜单"]').querySelectorAll('button')].map(b=>b.getAttribute('aria-label')||b.textContent)`),['基本信息','完整角色','视觉资源','显示角色立绘','角色移动'])
  const menuBox=await evaluate(`(()=>{const e=document.querySelector('[aria-label="角色菜单"]'),r=e.getBoundingClientRect();return {x:r.x,right:r.right,y:r.y,bottom:r.bottom}})()`)
  assert.ok(menuBox.x>=0&&menuBox.right<=1536&&menuBox.bottom<=780)
  await send({action:'press',selector:'[aria-label="角色菜单"] button:focus',key:'ArrowDown'})
  assert.equal(await evaluate('document.activeElement.textContent'),'完整角色')
  await send({action:'press',selector:'[aria-label="角色菜单"] button:focus',key:'Escape'})
  assert.ok(await evaluate(`document.activeElement===document.querySelector('.workbench-titlebar [aria-label="角色"]')`))
  checks.push('顶部角色图标展开菜单，键盘上下选择与 Esc 返回触发按钮通过')
  for(const label of ['基本信息','完整角色','视觉资源','基本信息']){
    await menu();await item(label);await until(heading(label))
    assert.equal((await layout()).tabs.filter(tab=>tab.id==='page:configuration').length,1)
  }
  checks.push('基本信息、完整角色、视觉资源直接定位复用的配置标签，重复打开不新增实例')
  await menu();await item('显示角色立绘')
  await until(`!!document.querySelector('.workbench-surface:not([hidden]) [aria-label="角色立绘"]')`)
  await evaluate(`document.querySelector('.workbench-surface:not([hidden]) [aria-label="角色立绘"] button').click()`)
  await until(heading('视觉资源'))
  checks.push('未配置立绘时显示说明，配置立绘按钮直接打开视觉资源')
  await menu()
  assert.ok(await evaluate(`[...document.querySelector('[aria-label="角色菜单"]').querySelectorAll('button')].some(b=>b.textContent==='隐藏角色立绘'&&b.getAttribute('aria-checked')==='true')`))
  await item('隐藏角色立绘')
  await until(`!document.querySelector('.workbench-surface:not([hidden]) [aria-label="角色立绘"]')`)
  checks.push('角色菜单显示／隐藏立绘，状态与工作台实际可见区域同步')
  assert.equal(await evaluate(`document.querySelectorAll('[aria-label="调整角色位置"]').length`),0)
  await menu();await item('角色移动')
  await until(`!!document.querySelector('.workbench-surface:not([hidden]) [aria-label="角色立绘"][data-editing=true]')`)
  await menu()
  assert.equal(await evaluate(`document.querySelector('[aria-label="角色移动"]').getAttribute('aria-checked')`),'true')
  await send({action:'press',selector:'[aria-label="角色菜单"] button:focus',key:'Escape'})
  assert.ok(await evaluate(`!!document.querySelector('[aria-label="角色立绘"][data-editing=true]')`))
  await send({action:'press',selector:'.workbench-titlebar [aria-label="角色"]',key:'Escape'})
  await until(`!!document.querySelector('[aria-label="角色立绘"][data-editing=false]')`)
  checks.push('角色移动已移入菜单，开启显示角色并进入调整；Esc 先关闭菜单再退出调整')
  await menu();await item('角色移动')
  await until(`!!document.querySelector('[aria-label="角色立绘"][data-editing=true]')`)
  await menu();await item('角色移动')
  await until(`!!document.querySelector('[aria-label="角色立绘"][data-editing=false]')`)
  await menu();await item('角色移动')
  await menu();await item('隐藏角色立绘')
  await menu()
  assert.equal(await evaluate(`document.querySelector('[aria-label="角色移动"]').getAttribute('aria-checked')`),'false')
  await send({action:'press',selector:'[aria-label="角色菜单"] button:focus',key:'Escape'})
  checks.push('移动开关可反复关闭与开启，隐藏角色后复位；聊天旧入口已移除')
  const widths=[1536,1100,800,480,375]
  for(const width of widths){
    await send({action:'viewport',width,height:780})
    await menu()
    const view=await evaluate(`(()=>{const t=document.querySelector('.workbench-titlebar'),e=t.querySelector('[aria-label="角色"]'),m=document.querySelector('[aria-label="角色菜单"]'),r=m.getBoundingClientRect();return {button:e.getBoundingClientRect().right,menuLeft:r.x,menuRight:r.right,menuBottom:r.bottom,scroll:document.documentElement.scrollWidth}})()`)
    assert.ok(view.button<=width+1&&view.menuLeft>=0&&view.menuRight<=width+1&&view.menuBottom<=780&&view.scroll<=width+1)
    await send({action:'press',selector:'[aria-label="角色菜单"] button:focus',key:'Escape'})
  }
  checks.push('五种窗口宽度下角色图标与下拉菜单均在视口内')
  assert.equal(await evaluate(`(async()=>JSON.stringify((await window.edenAgentDesktop.invoke('get_local_runtime_config')).character))()`),characterBefore)
  checks.push('角色资料保持原值，未选择素材或发送模型请求')
  await send({action:'viewport'})
  await evaluate(`(async()=>{if(Math.abs(innerWidth-outerWidth)>40||outerHeight-innerHeight>80){await window.edenAgentDesktop.invoke('toggle_maximize_current_window');await new Promise(r=>setTimeout(r,400))}if(innerWidth<1200){await window.edenAgentDesktop.invoke('toggle_maximize_current_window');for(let n=0;n<20&&innerWidth<1200;n++)await new Promise(r=>setTimeout(r,100))}})()`)
  if(!original.tabs.some(tab=>tab.id==='page:configuration'))await evaluate(`document.getElementById('wb-tab-page%3Aconfiguration')?.parentElement.querySelector('[aria-label^="关闭标签"]').click()`)
  await activate(ledger.id)
  await menu()
  await send({action:'screenshot',name:'workbench-character-menu'})
  await writeFile(logs+'/workbench-character-desktop.json',JSON.stringify({passed:true,checks,widths},null,2))
  console.log(JSON.stringify({passed:true,checks}))
}catch(error){await writeFile(logs+'/workbench-character-desktop.json',JSON.stringify({passed:false,checks,error:error.message},null,2));throw error}
