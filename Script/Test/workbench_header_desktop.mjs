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
async function layout(){await pause();return evaluate(`JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('eden.workbench:')&&k.endsWith(']'))))`)}
const tabButton=id=>'wb-tab-'+encodeURIComponent(id)
const toolbar=id=>`.workbench-document-toolbar[data-document=${JSON.stringify(id)}]`
const surface=id=>`.workbench-surface[data-document=${JSON.stringify(id)}]`
async function activate(id){await evaluate(`document.getElementById(${JSON.stringify(tabButton(id))}).click()`);await pause()}
async function action(id,label){await evaluate(`(()=>{const b=[...document.querySelector(${JSON.stringify(toolbar(id))}).querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Tool unavailable');b.click()})()`);await pause()}
async function popup(label){
  const geometry=await evaluate(`(()=>{const e=document.querySelector('[role=dialog][aria-label='+${JSON.stringify(JSON.stringify(label))}+']'),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+Math.min(20,r.width/2),r.y+Math.min(20,r.height/2));return {open:e.matches(':popover-open'),inside:e===hit||e.contains(hit),x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight}})()`)
  assert.equal(geometry.open,true);assert.equal(geometry.inside,true)
  assert.ok(geometry.x>=0&&geometry.y>=0&&geometry.right<=geometry.width+1&&geometry.bottom<=geometry.height+1)
}
try{
  assert.ok(driver.root.includes('eden-plugin-desktop-'))
  await until(`!!document.querySelector('.workbench-shell')`)
  await send({action:'viewport',width:1536,height:780})
  let original=await layout()
  const ledger=original.tabs.find(tab=>tab.kind==='plugin'&&tab.viewKey.startsWith('chat-ledger/'))
  await activate(ledger.id)
  await send({action:'click',name:'新建聊天页面'})
  let state=await layout(),draft=state.tabs.find(tab=>tab.id===state.active[state.focused])
  assert.equal(draft.kind,'chat');assert.equal(draft.sessionId,'')
  await until(`!!document.querySelector(${JSON.stringify(toolbar(draft.id)+' [role=toolbar]')})`)
  const merged=await evaluate(`(()=>{const t=document.querySelector(${JSON.stringify(toolbar(draft.id)+' [role=toolbar]')}),h=t.closest('.workbench-tabs'),m=document.querySelector(${JSON.stringify(surface(draft.id)+' main')}),a=h.getBoundingClientRect(),b=t.getBoundingClientRect(),c=m.getBoundingClientRect();return {sameRow:b.y>=a.y&&b.bottom<=a.bottom+1,adjacent:Math.abs(c.y-a.bottom)<2,rows:m.querySelectorAll(':scope>header').length,height:a.height}})()`)
  assert.equal(merged.sameRow,true);assert.equal(merged.adjacent,true);assert.equal(merged.rows,0);assert.equal(merged.height,38)
  checks.push('标签与会话工具同在 38px 标题栏，聊天内不再占用第二行')
  await action(draft.id,'调整回复长度');await popup('回复长度')
  await action(draft.id,'关闭回复长度设置')
  await until(`!document.querySelector(${JSON.stringify(toolbar(draft.id)+' [aria-label="调整界面外观"]')})?.disabled`)
  await action(draft.id,'调整界面外观');await popup('界面外观');await action(draft.id,'关闭外观设置')
  checks.push('回复长度与外观菜单可展开，菜单位于顶层且未被编辑组裁切')
  await action(draft.id,'关闭新消息自动滚动')
  await send({action:'fill',selector:surface(draft.id)+' textarea',text:'合并标题栏：实例草稿'})
  await send({action:'press',selector:surface(draft.id)+' textarea',key:'Control+s'})
  await evaluate(`window.__headerProbe=document.querySelector(${JSON.stringify(toolbar(draft.id)+' [role=toolbar]')})`)
  await evaluate(`(()=>{const h=document.getElementById(${JSON.stringify(tabButton(draft.id))}).closest('.workbench-tabs');h.querySelector('[aria-label="将当前页面移至工具侧栏"]').click()})()`)
  await pause()
  assert.equal(await evaluate(`window.__headerProbe===document.querySelector(${JSON.stringify(toolbar(draft.id)+' [role=toolbar]')})`),true)
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(surface(draft.id)+' textarea')}).value`),'合并标题栏：实例草稿')
  assert.equal((await layout()).tabs.find(tab=>tab.id===draft.id).group,'auxiliary')
  assert.ok(await evaluate(`!!document.querySelector(${JSON.stringify(toolbar(draft.id)+' [aria-label="开启新消息自动滚动"]')})`))
  checks.push('会话移至工具侧栏时沿用同一工具栏节点，草稿及自动滚动状态保留')
  const sibling=(await layout()).tabs.find(tab=>tab.kind==='chat'&&tab.group==='auxiliary'&&tab.id!==draft.id)
  await action(draft.id,'调整回复长度');await popup('回复长度')
  await activate(sibling.id)
  assert.equal(await evaluate(`document.querySelectorAll(':popover-open').length`),0)
  assert.ok(await evaluate(`document.querySelector(${JSON.stringify(toolbar(draft.id))}).hidden`))
  await activate(draft.id)
  await action(draft.id,'调整回复长度');await popup('回复长度');await action(draft.id,'关闭回复长度设置')
  checks.push('切换标签隐藏对应工具栏并关闭所属弹层，恢复标签后可重新打开')
  for(const width of [1536,1100,800,480,375]){
    await send({action:'viewport',width,height:780});await pause()
    const row=await evaluate(`(()=>{const h=document.querySelector(${JSON.stringify(toolbar(draft.id)+' [role=toolbar]')}).closest('.workbench-tabs'),r=h.getBoundingClientRect(),list=h.querySelector('[role=tablist]').getBoundingClientRect(),buttons=[...h.querySelectorAll('button')].filter(b=>b.getClientRects().length&&!b.closest('.workbench-tablist')&&!b.closest('[hidden]')),input=document.querySelector(${JSON.stringify(surface(draft.id)+' .workbench-composer')}).getBoundingClientRect();return {scroll:document.documentElement.scrollWidth,listWidth:list.width,composer:input.y>=r.bottom&&input.bottom<=innerHeight+1,inside:buttons.every(b=>{const x=b.getBoundingClientRect();return x.x>=r.x-1&&x.right<=r.right+1&&x.y>=r.y&&x.bottom<=r.bottom+1}),more:!![...h.querySelectorAll('[aria-label="编辑组操作"]')].find(b=>b.getClientRects().length)}})()`)
    assert.ok(row.scroll<=width+1);assert.ok(row.listWidth>=80);assert.equal(row.inside,true);assert.equal(row.composer,true)
    if(width<=480)assert.equal(row.more,true)
  }
  await action(draft.id,'调整界面外观');await popup('界面外观');await action(draft.id,'关闭外观设置')
  await send({action:'screenshot',name:'workbench-header-narrow'})
  checks.push('五种窗口宽度均保持单行、标签可见；窄栏布局操作进入更多且弹层完整')
  await send({action:'viewport'})
  await evaluate(`(async()=>{if(Math.abs(innerWidth-outerWidth)>40||outerHeight-innerHeight>80){await window.edenAgentDesktop.invoke('toggle_maximize_current_window');await new Promise(r=>setTimeout(r,400))}if(innerWidth<1200){await window.edenAgentDesktop.invoke('toggle_maximize_current_window');for(let n=0;n<20&&innerWidth<1200;n++)await new Promise(r=>setTimeout(r,100))}})()`)
  await send({action:'fill',selector:surface(draft.id)+' textarea',text:''})
  await send({action:'press',selector:surface(draft.id)+' textarea',key:'Control+s'})
  await evaluate(`document.getElementById(${JSON.stringify(tabButton(draft.id))}).parentElement.querySelector('[aria-label^="关闭标签"]').click()`)
  await activate(sibling.id);await activate(ledger.id)
  await send({action:'screenshot',name:'workbench-header-merged'})
  await evaluate(`delete window.__headerProbe`)
  await writeFile(logs+'/workbench-header-desktop.json',JSON.stringify({passed:true,checks,merged,widths:[1536,1100,800,480,375]},null,2))
  console.log(JSON.stringify({passed:true,checks}))
}catch(error){await writeFile(logs+'/workbench-header-desktop.json',JSON.stringify({passed:false,checks,error:error.message},null,2));throw error}
