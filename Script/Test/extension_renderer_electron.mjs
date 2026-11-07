import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url), electron = require('electron')
const root = await mkdtemp(path.join(tmpdir(),'eden-extension-electron-'))
const helper = fileURLToPath(new URL('../../frontend/desktop/src/app/extension-renderers.cjs',import.meta.url))
const evidence = fileURLToPath(new URL('../../../.run/logs/extension-renderer-electron.json',import.meta.url))
const frame = `<script>parent.postMessage('ready','*');onmessage=()=>{while(true){}};</script>`
const html = `<script>onmessage=e=>{if(e.data==='ready')window.ready=true};</script><iframe sandbox="allow-scripts"></iframe><script>document.querySelector('iframe').srcdoc=atob(${JSON.stringify(Buffer.from(frame).toString('base64'))});</script>`
let child
try {
  const script = `const {app,BrowserWindow,protocol}=require('electron');
    require(${JSON.stringify(helper)}).configureExtensionRenderers(app);
    app.setPath('userData',${JSON.stringify(path.join(root,'profile'))});
    protocol.registerSchemesAsPrivileged([{scheme:'edenagent',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const bounded=promise=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('Renderer did not respond')),3000))]);
    app.whenReady().then(async()=>{let win;try{
      protocol.handle('edenagent',()=>new Response(${JSON.stringify(html)},{headers:{'content-type':'text/html; charset=utf-8'}}));
      win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
      await win.loadURL('edenagent://app/index.html');
      const end=Date.now()+10000;while(!await bounded(win.webContents.executeJavaScript('window.ready===true'))){if(Date.now()>end)throw Error('Frame did not initialize');await sleep(50)}
      const parent=win.webContents.mainFrame,frame=parent.frames[0];
      const result={parentProcess:parent.processId,extensionProcess:frame.processId};
      if(result.parentProcess===result.extensionProcess)throw Error('Extension shares the workbench renderer');
      await win.webContents.executeJavaScript("document.querySelector('iframe').contentWindow.postMessage('hang','*')");
      await sleep(200);result.parentResponsive=await bounded(win.webContents.executeJavaScript('1+1'))===2;
      result.removed=await bounded(win.webContents.executeJavaScript("document.querySelector('iframe').remove(); document.querySelectorAll('iframe').length===0"));
      const passed=result.parentResponsive&&result.removed;
      console.log('EDEN_RESULT '+JSON.stringify({...result,passed}));app.exit(passed?0:1);
    }catch(error){console.error(error);win?.destroy();app.exit(1)}});`
  const filename = path.join(root,'main.cjs');await writeFile(filename,script)
  const env = {...process.env};delete env.ELECTRON_RUN_AS_NODE
  let output=''
  child=spawn(electron,[filename],{env,windowsHide:true,stdio:['ignore','pipe','pipe']})
  child.stdout.on('data',data=>{output+=data});child.stderr.on('data',data=>{output+=data})
  const timer=setTimeout(()=>child.kill(),25000)
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)})
  clearTimeout(timer)
  assert.equal(code,0,output)
  const match=output.match(/EDEN_RESULT (\{[^\n]+\})/);assert.ok(match,output)
  const result=JSON.parse(match[1]);assert.equal(result.passed,true)
  await mkdir(path.dirname(evidence),{recursive:true});await writeFile(evidence,JSON.stringify(result,null,2))
  console.log(JSON.stringify(result))
} finally {
  if(child?.exitCode===null)child.kill()
  assert.equal(path.dirname(root),tmpdir());assert.ok(path.basename(root).startsWith('eden-extension-electron-'))
  await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100})
}
