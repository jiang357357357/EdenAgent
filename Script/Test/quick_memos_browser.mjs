import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../../Server/src/bootstrap/container.ts'
import { loadConfig } from '../../Server/src/bootstrap/config.ts'
import { MemoRepository } from '../../Server/src/modules/memos/index.ts'
import { memoCreateSchema } from '@eden/api'
import { recordedModel } from '@eden/runtime-pi/testing'
import { isolatedBrowser, until } from './browser-cdp.mjs'
import { pluginBrowserHarness } from './plugin-browser-harness.mjs'

if (!process.argv[2]) throw new Error('Usage: node --import tsx Script/Test/quick_memos_browser.mjs <plugin-source-directory>')
const source = path.resolve(process.argv[2]), root = await mkdtemp(path.join(tmpdir(), 'eden-quick-memos-'))
const evidence = fileURLToPath(new URL('../../../.run/logs/', import.meta.url)), checks = []
let host, web, browser, model, boot = {}
try {
  model = await recordedModel([{ wait: true }, { wait: true }])
  web = await pluginBrowserHarness(() => boot)
  const config = { ...loadConfig({ EDEN_AGENT_DATA_ROOT: path.join(root, 'host'), EDEN_AGENT_PORT: '0', EDEN_AGENT_ALLOWED_ORIGINS: web.origin }, root), model: model.config }
  host = await startServer(config); host.permissions.setMode('full_access')
  const sessionId = host.sessions.repository.create('快捷备忘隔离验收', [], null).id
  const database = host.sessions.repository.database, memos = new MemoRepository(database)
  for (let i = 0; i < 235; i++) memos.create(memoCreateSchema.parse({ title: `合成备忘-${i}` }))
  boot = { token: config.token, baseUrl: `http://127.0.0.1:${host.port}`, workspaceId: config.workspaceId, sessionId }
  browser = await isolatedBrowser(path.join(root, 'browser'))
  await browser.command('Page.navigate', { url: web.url })
  await until(() => browser.evaluate('typeof window.__call === "function"'))
  const call = (method, input) => browser.evaluate(`window.__call(${JSON.stringify(method)},${JSON.stringify(input)})`)
  const preview = await call('plugin.inspect', { sourceType: 'local', sourceUri: source })
  await call('plugin.install_preview', { previewID: preview.previewID, activate: true, enabled: false, requireVerified: false })
  await call('plugin.enable', { id: 'quick-memos', enabled: true })
  await until(() => browser.evaluate('Boolean(document.querySelector("[aria-label=打开应用扩展]"))'))
  await browser.evaluate('document.querySelector("[aria-label=打开应用扩展]").click()')
  await until(() => browser.evaluate('[...document.querySelectorAll("nav button")].some(item=>item.textContent.includes("快捷备忘"))'))
  await browser.evaluate('[...document.querySelectorAll("nav button")].find(item=>item.textContent.includes("快捷备忘")).click()')
  const text = () => browser.evaluate('document.body.innerText')
  const click = label => browser.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(label)}&&!button.disabled).click()`)
  await until(async () => (await text()).includes('已加载 80 条'))
  await click('加载更多'); await until(async () => (await text()).includes('已加载 160 条'))
  await click('加载更多'); await until(async () => (await text()).includes('已加载 235 条'))
  assert.equal(await browser.evaluate('document.querySelectorAll(".qm-item").length'), 235)
  checks.push('实际 quick-memos 源码安装后，通过真实工具分页读取全部 235 条')
  host.sessions.start(sessionId, '保持当前模型回复进行中')
  await until(() => model.requests.length === 1)
  const target = await browser.evaluate('document.querySelector(".qm-item-title").textContent')
  await browser.evaluate('document.querySelector(".qm-item button").click()')
  await until(async () => (await text()).includes('正在等待当前会话空闲'))
  await click('取消操作')
  await until(() => browser.evaluate('!document.querySelector(".qm-item button").disabled'))
  assert.equal(database.connection.prepare('SELECT status FROM memos WHERE title=?').get(target).status, 'active')
  checks.push('真实浏览器可取消等待中的完成操作，未发生写入')
  await browser.evaluate(`(()=>{const input=document.querySelector('[aria-label="备忘标题"]');input.focus();input.select();})()`)
  await browser.command('Input.insertText', { text: '隔离提醒，不向真实联系人投递' })
  await browser.evaluate(`(()=>{const select=document.querySelector('[aria-label="类型"]');select.value='reminder';select.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  await until(() => browser.evaluate('Boolean(document.querySelector("[aria-label=提醒时间]"))'))
  assert.equal(await browser.evaluate('document.querySelector("[aria-label=提醒方式]").value'), 'auto')
  await browser.evaluate(`(()=>{const input=document.querySelector('[aria-label="提醒时间"]'),date=new Date(Date.now()+3600000);
    date.setMinutes(date.getMinutes()-date.getTimezoneOffset());Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,date.toISOString().slice(0,16));input.dispatchEvent(new Event('input',{bubbles:true}));})()`)
  await click('添加'); await until(async () => (await text()).includes('正在等待当前会话空闲'))
  model.releaseWaiting(); await host.sessions.waitForIdle(sessionId)
  await until(async () => (await text()).includes('提醒已保存'))
  const reminder = database.connection.prepare('SELECT * FROM memos WHERE title=?').all('隔离提醒，不向真实联系人投递')
  assert.equal(reminder.length, 1); assert.deepEqual(JSON.parse(reminder[0].delivery_json), { channel: 'auto' })
  assert.equal(database.connection.prepare('SELECT status FROM memos WHERE title=?').get(target).status, 'active')
  checks.push('取消后的旧操作不会晚到执行，忙碌时创建提醒仅执行一次并保留 auto 渠道')
  await browser.evaluate(`(()=>{const input=document.querySelector('[aria-label="备忘标题"]');input.focus();input.select();})()`)
  await browser.command('Input.insertText', { text: '隔离桌面渠道提醒' })
  await browser.evaluate(`(()=>{const select=document.querySelector('[aria-label="提醒方式"]');select.value='app';select.dispatchEvent(new Event('change',{bubbles:true}));
    const input=document.querySelector('[aria-label="提醒时间"]'),date=new Date(Date.now()+3600000);date.setMinutes(date.getMinutes()-date.getTimezoneOffset());
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,date.toISOString().slice(0,16));input.dispatchEvent(new Event('input',{bubbles:true}));})()`)
  await click('添加')
  await until(() => database.connection.prepare('SELECT COUNT(*) AS count FROM memos WHERE title=?').get('隔离桌面渠道提醒').count === 1)
  await until(() => browser.evaluate('!document.querySelector(".qm-head button").disabled'))
  assert.deepEqual(JSON.parse(database.connection.prepare('SELECT delivery_json FROM memos WHERE title=?').get('隔离桌面渠道提醒').delivery_json), { channel: 'app' })
  checks.push('用户明确选择桌面渠道时按 app 保存，没有被默认 auto 覆盖')
  host.sessions.start(sessionId, '保持第二次模型回复进行中')
  await until(() => model.requests.length === 2)
  const closingTarget = await browser.evaluate('document.querySelector(".qm-item-title").textContent')
  await browser.evaluate('document.querySelector(".qm-item button").click()')
  await until(async () => (await text()).includes('正在等待当前会话空闲'))
  await browser.evaluate(`document.querySelector('[aria-label="关闭标签 快捷备忘"]').click()`)
  await until(() => browser.evaluate('!document.querySelector(".qm-root")'))
  model.releaseWaiting(); await host.sessions.waitForIdle(sessionId)
  assert.equal(database.connection.prepare('SELECT status FROM memos WHERE title=?').get(closingTarget).status, 'active')
  checks.push('关闭实际插件标签取消排队操作，模型结束后仍不写入')
  assert.deepEqual(browser.errors, [])
  await mkdir(evidence, { recursive: true })
  const result = { passed: true, checks, browserExceptions: browser.errors,
    sourceSha256: createHash('sha256').update(await readFile(path.join(source, 'client.js'))).digest('hex'),
    data: 'isolated synthetic memos, recorded local model, actual plugin code, host tools and browser' }
  await writeFile(path.join(evidence, 'quick-memos-browser.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result))
} catch (error) {
  await mkdir(evidence, { recursive: true })
  await writeFile(path.join(evidence, 'quick-memos-browser.json'), JSON.stringify({ passed: false, checks, error: String(error),
    surface: await browser?.evaluate('document.body.innerText').catch(() => ''), browserExceptions: browser?.errors }, null, 2))
  throw error
} finally {
  await browser?.close(); await web?.close(); await host?.close(); await model?.close()
  assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()))
  assert.ok(path.basename(root).startsWith('eden-quick-memos-'))
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
