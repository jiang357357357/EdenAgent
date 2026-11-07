import { mkdir, writeFile, access } from 'node:fs/promises'
import path from 'node:path'

const [directory, id = 'my-extension'] = process.argv.slice(2)
if (!directory || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(id)) throw new Error('Usage: node Script/Project/create_extension.mjs <new-directory> [extension-id]')
const root = path.resolve(directory)
try { await access(root); throw new Error('Output directory already exists; refusing to overwrite source') }
catch (error) { if (error.code !== 'ENOENT') throw error }
await mkdir(root, { recursive: true })
const files = {
  'plugin.json': JSON.stringify({ schemaVersion: 1, id, name: '我的扩展', description: 'Eden 扩展 API 2 示例', version: '1.0.0',
    components: { ui: [{ id: 'main', entry: 'ui.json', enabledByDefault: true }] } }, null, 2),
  'ui.json': JSON.stringify({ schemaVersion: 1, type: 'module', apiVersion: 2, entry: 'extension.js',
    activationEvents: ['onCommand', 'onView'], capabilities: { sessionRead: true, sessionSend: false, tools: [] },
    views: [{ id: 'main', title: '我的扩展', slot: 'page', renderer: 'webview', entry: 'view.html' },
      { id: 'items', title: '扩展数据', slot: 'sidebar_panel', renderer: 'tree' }],
    contributes: { commands: [{ id: 'open', title: '打开扩展' }, { id: 'increment', title: '增加计数', when: { sessionAvailable: true } }],
      menus: [{ location: 'activity', command: 'open' }, { location: 'toolbar', command: 'increment' }],
      keybindings: [{ command: 'open', key: 'Ctrl+Alt+E' }], statusBar: [{ id: 'counter', text: '扩展计数', command: 'open' }],
      configuration: { greeting: { title: '问候语', type: 'string', default: '你好，老师' } } } }, null, 2),
  'extension.js': `export function activate(api) {
  api.registerCommand('open', context => context.openView('main'));
  api.registerCommand('increment', async context => {
    const storage = context.storage('global');
    const previous = await storage.get('count');
    const result = await storage.update('count', Number(previous.value || 0) + 1, previous.revision);
    await context.setStatusBarItem('counter', '计数 ' + result.value);
    await context.refreshTree('items');
    await context.postMessage(result.value);
    return result.value;
  });
  api.registerTreeDataProvider('items', async context => {
    const count = await context.storage('global').get('count');
    return [{ id: 'count', label: '已保存计数：' + Number(count.value || 0), command: 'increment' }];
  });
  api.registerWebviewMessageHandler('main', async context => {
    const setting = await context.configuration('global').get('greeting');
    return { greeting: setting.value, count: (await context.storage('global').get('count')).value };
  });
  api.log('info', '扩展已激活');
}
`,
  'view.html': `<main style="padding:20px"><h1>我的扩展</h1><p id="value" role="status">正在读取…</p><button id="increment">增加并保存</button><p id="error" role="alert"></p></main>
<script>
acquireEdenApi().then(async api => {
  const showError = error => document.getElementById('error').textContent = String(error);
  const render = async () => { const value = await api.request('message', {}); document.getElementById('value').textContent = value.greeting + ' · ' + Number(value.count || 0); };
  api.onDidReceiveMessage(() => render().catch(showError));
  api.onDidChangeConfiguration(() => render().catch(showError));
  document.getElementById('increment').onclick = async () => {
    const button = document.getElementById('increment'); button.disabled = true;
    try { await api.request('command', { id: 'increment' }); await render(); }
    catch (error) { showError(error); } finally { button.disabled = false; }
  };
  await render();
}).catch(error => document.getElementById('error').textContent = String(error));
</script>`,
  'README.md': `# ${id}\n\n在 Eden 应用会话中，使用 manage_ui_plugins 先 inspect 此目录，再 install。\n\nextension.js 在独立 Worker 中执行；view.html 在独立页面上下文执行。业务操作经过宿主工具与审批。\n\n开发时在浏览器开发者工具的 Worker 列表选择 eden:${id}，可设置断点；通过扩展诊断查看状态和日志。\n\n公开类型：@eden/plugin-sdk/extension。HTML 内通过 await acquireEdenApi() 获取页面接口。修改源码后重新检查并安装，文件保存不代表已安装版本更新。\n`,
}
for (const [name, content] of Object.entries(files)) await writeFile(path.join(root, name), content, { encoding: 'utf8', flag: 'wx' })
process.stdout.write(`Created extension source: ${root}\n`)
