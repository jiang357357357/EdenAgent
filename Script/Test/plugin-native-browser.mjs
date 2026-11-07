import { spawn } from 'node:child_process'
import { mkdir,readFile,writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { connectBrowser,until } from './browser-cdp.mjs'

export async function pluginNativeBrowser(profile,url) {
  await mkdir(profile,{recursive:true})
  const require=createRequire(import.meta.url),electron=require('electron')
  const source=fileURLToPath(new URL('../../frontend/desktop/src/',import.meta.url))
  const filename=path.join(profile,'native.cjs')
  const script=`const{app,BrowserWindow}=require('electron');
    app.setPath('userData',${JSON.stringify(profile)});app.commandLine.appendSwitch('remote-debugging-port','0');
    require(${JSON.stringify(path.join(source,'app/extension-renderers.cjs'))}).configureExtensionRenderers(app);
    const{createWebAppLoader}=require(${JSON.stringify(path.join(source,'windows/web-app-loader.cjs'))});
    const{isInternalAppUrl,isSupportedExternalUrl}=require(${JSON.stringify(path.join(source,'protocols/navigation-policy.cjs'))});
    app.whenReady().then(async()=>{
      const window=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
      const setOpen=window.webContents.setWindowOpenHandler.bind(window.webContents);
      // Visibility only: use the production policy, preload and navigation guards unchanged.
      window.webContents.setWindowOpenHandler=handler=>setOpen(details=>{const result=handler(details);return result.action==='allow'?{...result,overrideBrowserWindowOptions:{...result.overrideBrowserWindowOptions,show:false}}:result});
      createWebAppLoader({app,shell:{openExternal:async()=>{}},getWebPort:()=>${JSON.stringify(new URL(url).port)},defaultWebPort:40091,isInternalAppUrl,isSupportedExternalUrl}).attachNavigationPolicy(window);
      await window.loadURL(${JSON.stringify(url)});
    }).catch(error=>{console.error(error);app.exit(1)});app.on('window-all-closed',()=>app.quit());`
  await writeFile(filename,script)
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
  const child=spawn(electron,[filename],{windowsHide:true,env,stdio:['ignore','pipe','pipe']})
  let output='';child.stdout.on('data',value=>{output=(output+value).slice(-8000)});child.stderr.on('data',value=>{output=(output+value).slice(-8000)})
  try {
    let port
    await until(async()=>{
      try {port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0])}catch{port=Number(output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/)?.[1])}
      if(child.exitCode!==null)throw Error('Electron exited: '+output)
      return port>0
    })
    const browser=await connectBrowser(port,()=>until(()=>child.exitCode!==null,5000).catch(()=>child.kill()))
    await until(()=>browser.evaluate('typeof window.__call==="function"'))
    return browser
  } catch(error){child.kill();throw Error(String(error)+'\n'+output)}
}
