import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, transformWithEsbuild } from 'vite'

/** Production UI host and transport, with only the test window's connection bootstrap supplied. */
export async function pluginBrowserHarness(boot, options = {}) {
  const root = fileURLToPath(new URL('../../frontend/web/', import.meta.url))
  const entry = '\0__plugin_harness.tsx'
  const vite = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir: options.cacheDir,
    server: { host: '127.0.0.1', port: 0, strictPort: false, open: false },
    plugins: [{ name: 'plugin-acceptance-harness',
      resolveId(id) { if (id === '/__plugin_harness.tsx') return entry },
      async load(id) {
        if (id !== entry) return
        return transformWithEsbuild(`import React from 'react'; import {createRoot} from 'react-dom/client';
          import '/src/index.css';
          import {PluginUiProvider} from '/src/components/plugin-ui/PluginUiProvider.tsx';
          import {Workbench} from '/src/components/workbench/Workbench.tsx';
          import {MemoPage} from '/src/pages/memo/MemoPage.tsx';
          ${options.applicationPages ? "import {ApplicationPagesAcceptance} from '/tests/fixtures/application-pages.tsx';" : ''}
          ${options.presentations ? "import {PluginPresentationsAcceptance} from '/tests/fixtures/plugin-presentations.tsx';" : ''}
          import {initialWorkbench,workbenchReducer} from '/src/components/workbench/workbench-state.ts';
          import {rpcRequestForOrigin} from '/src/lib/rpc-transport.ts';
          window.__call=(method,params)=>rpcRequestForOrigin('local',method,params);
          function Workspace(){
            const [state,dispatch]=React.useReducer(workbenchReducer,undefined,initialWorkbench);
            window.__openFile=path=>dispatch({type:'open',document:{id:'file:'+path,kind:'file',path,title:path,sessionId:window.__testBoot.sessionId}});
            ${options.applicationPages ? 'return <ApplicationPagesAcceptance/>;' : ''}
            ${options.presentations ? 'return <PluginPresentationsAcceptance/>;' : ''}
            if(${Boolean(options.memo)}) return <MemoPage onBack={()=>{}} roleSessionId={window.__testBoot.sessionId}/>;
            return <Workbench state={state} dispatch={dispatch} sidebar={null} sessionId={window.__testBoot.sessionId} running={false}
              onSelect={id=>dispatch({type:'select',id})} onNewChat={()=>{}}
              onOpenPlugin={(view,sessionId=window.__testBoot.sessionId)=>dispatch({type:'open',document:{id:'plugin:'+view.key,kind:'plugin',title:view.view.title,viewKey:view.key,sessionId,slot:view.view.slot}})} />;
          }
          createRoot(document.getElementById('root')).render(<React.StrictMode>
            <PluginUiProvider origin="local" enabled sessionId={window.__testBoot.sessionId}>
              <main style={{height:'100vh',background:'var(--color-bg)',color:'var(--color-text)'}}><Workspace/></main>
            </PluginUiProvider></React.StrictMode>);`, 'plugin-harness.tsx', { loader: 'tsx', jsx: 'automatic' })
      },
      configureServer(server) {
        server.middlewares.use('/__plugin_acceptance', async (_request, response) => {
          response.setHeader('Content-Type', 'text/html; charset=utf-8')
          const bootstrap = JSON.stringify(boot()).replaceAll('<', '\\u003c')
          response.end(await server.transformIndexHtml('/__plugin_acceptance', `<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div>
            <script>window.__testBoot=${bootstrap};localStorage.setItem('agent.runtime_origin','local');window.edenAgentDesktop={getAgentCapability:async()=>window.__testBoot};</script>
            <script type="module" src="/__plugin_harness.tsx"></script></body></html>`))
        })
      },
    }],
  })
  await vite.listen()
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`
  return { origin, url: `${origin}/__plugin_acceptance`, close: () => vite.close() }
}
