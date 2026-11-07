import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const logs=fileURLToPath(new URL('../../../.run/logs/',import.meta.url))
const driver=JSON.parse(await readFile(logs+'/plugin-desktop-driver.json','utf8'))
const checks=[],measurements=[]
async function send(command){const response=await fetch(driver.url,{method:'POST',body:JSON.stringify(command),signal:AbortSignal.timeout(45000)});const value=await response.json();if(!response.ok)throw Error(value.error);return value.result}
const evaluate=expression=>send({action:'evaluate',expression})
const pause=()=>new Promise(resolve=>setTimeout(resolve,250))
const layout=async()=>{await pause();return evaluate(`JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('eden.workbench:')&&k.endsWith(']'))))`)}
async function until(expression){for(let n=0;n<80;n++){if(await evaluate(expression))return;await pause()}throw Error('Timed out: '+expression)}
async function activate(id){await evaluate(`document.getElementById(${JSON.stringify('wb-tab-'+encodeURIComponent(id))}).click()`);await pause()}
const surface=id=>`.workbench-surface[data-document=${JSON.stringify(id)}]`
async function geometry(){return evaluate(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};return [...document.querySelectorAll('.workbench-surface:not([hidden]) .workbench-composer')].map(e=>{const s=e.closest('.workbench-surface'),m=e.querySelector('.workbench-composer-meters');return {document:s.dataset.document,surface:rect(s),composer:rect(e),meters:rect(m),timer:rect(m.querySelector('[role=timer]')),context:rect(m.querySelector('[aria-label^="上下文占用"]')),actions:rect(e.querySelector('.workbench-composer-actions')),models:rect(e.querySelector('.workbench-composer-models')),send:rect(e.querySelector('.workbench-composer-send'))}})})()`)}
try{
  assert.ok(driver.root.includes('eden-plugin-desktop-'))
  await until(`!!document.querySelector('.workbench-shell')`)
  await send({action:'viewport',width:1536,height:780})
  const original=await layout(),ledger=original.tabs.find(t=>t.kind==='plugin'&&t.viewKey.startsWith('chat-ledger/'))
  await activate(ledger.id)
  await send({action:'click',name:'新建聊天页面'})
  const state=await layout(),draft=state.tabs.find(t=>t.id===state.active[state.focused])
  assert.equal(draft.kind,'chat');assert.equal(draft.sessionId,'')
  await until(`!!document.querySelector(${JSON.stringify(surface(draft.id)+' textarea')})`)
  const sizes=[[1536,780],[1400,780],[1280,780],[1100,780],[1000,780],[800,780],[600,780],[480,780],[375,780],[1536,480],[1536,360]]
  for(const [width,height] of sizes){
    await send({action:'viewport',width,height})
    await evaluate(`document.querySelector(${JSON.stringify(surface(draft.id)+' textarea')}).focus()`)
    await pause()
    const rows=await geometry();assert.ok(rows.length)
    for(const row of rows){
      assert.ok(row.meters.x>=row.composer.right+4,'Meters must be outside and to the right')
      assert.ok(row.meters.y>=row.composer.y-1&&row.meters.bottom<=row.composer.bottom+1,'Meters must stay beside the composer')
      assert.ok(row.meters.right<=row.surface.right+1,'The group must reserve space for both meters')
      assert.ok(Math.abs(row.timer.x-row.context.x)<1&&row.context.y>=row.timer.bottom+4,'Clock and context must stack vertically')
      assert.ok(row.composer.x>=row.surface.x&&row.composer.bottom<=height+1)
      assert.ok(row.actions.right<=row.models.x+1&&row.models.right<=row.send.x+1,`Composer actions overlap at ${width}x${height}`)
    }
    measurements.push({width,height,rows})
  }
  checks.push('十一种窗口宽高组合：时钟与上下文始终在输入框右侧纵向排列，不盖住内容或越过分栏边界')
  await evaluate(`document.querySelector(${JSON.stringify(surface(draft.id)+' [role=timer]')}).focus()`)
  await pause()
  const tooltip=await evaluate(`(()=>{const a=document.querySelector(${JSON.stringify(surface(draft.id)+' [role=timer]')}),t=document.getElementById(a.getAttribute('aria-describedby'));return {visible:getComputedStyle(t).visibility,text:t.textContent}})()`)
  assert.equal(tooltip.visible,'visible');assert.match(tooltip.text,/思考耗时/)
  await evaluate(`document.querySelector(${JSON.stringify(surface(draft.id)+' [aria-label^="上下文占用"]')}).click()`)
  await until(`!![...document.querySelectorAll('dialog[open]')].find(e=>e.textContent.includes('上下文上限'))`)
  await evaluate(`document.querySelector('[aria-label="关闭上下文上限"]').click()`)
  await until(`!document.querySelector('dialog[open]')`)
  checks.push('计时明细仍可聚焦查看，上下文上限窗口可打开和关闭；未修改数值')
  await send({action:'viewport'})
  await evaluate(`(async()=>{if(Math.abs(innerWidth-outerWidth)>40||outerHeight-innerHeight>80){await window.edenAgentDesktop.invoke('toggle_maximize_current_window');await new Promise(r=>setTimeout(r,400))}if(innerWidth<1200){await window.edenAgentDesktop.invoke('toggle_maximize_current_window');for(let n=0;n<20&&innerWidth<1200;n++)await new Promise(r=>setTimeout(r,100))}})()`)
  await evaluate(`document.getElementById(${JSON.stringify('wb-tab-'+encodeURIComponent(draft.id))}).parentElement.querySelector('[aria-label^="关闭标签"]').click()`)
  await activate(ledger.id)
  await send({action:'screenshot',name:'workbench-meters-right'})
  await writeFile(logs+'/workbench-meters-desktop.json',JSON.stringify({passed:true,checks,measurements},null,2))
  console.log(JSON.stringify({passed:true,checks,sizes:sizes.length}))
}catch(error){await writeFile(logs+'/workbench-meters-desktop.json',JSON.stringify({passed:false,checks,measurements,error:error.message},null,2));throw error}
