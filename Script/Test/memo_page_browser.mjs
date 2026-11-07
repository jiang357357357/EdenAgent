import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../../Server/src/bootstrap/container.ts'
import { loadConfig } from '../../Server/src/bootstrap/config.ts'
import { MemoRepository } from '../../Server/src/modules/memos/index.ts'
import { memoCreateSchema } from '@eden/api'
import { isolatedBrowser, until } from './browser-cdp.mjs'
import { pluginBrowserHarness } from './plugin-browser-harness.mjs'

const root = await mkdtemp(path.join(tmpdir(), 'eden-memo-pagination-'))
const evidence = fileURLToPath(new URL('../../../.run/logs/', import.meta.url)), checks = []
const originalPage = MemoRepository.prototype.page
let host, web, browser, boot = {}, holdMore = false, holdSearch = false, release, releaseSearch
try {
  web = await pluginBrowserHarness(() => boot, { memo: true })
  const config = loadConfig({ EDEN_AGENT_DATA_ROOT: path.join(root, 'host'), EDEN_AGENT_PORT: '0', EDEN_AGENT_ALLOWED_ORIGINS: web.origin }, root)
  host = await startServer(config)
  host.permissions.setMode('full_access')
  const sessionId = host.sessions.repository.create('备忘分页隔离验收', [], null).id
  const memos = new MemoRepository(host.sessions.repository.database)
  for (let i = 0; i < 435; i++) memos.create(memoCreateSchema.parse({ title: i % 50 === 0 ? `search-needle-${i}` : `分页记录-${i}` }))
  boot = { token: config.token, baseUrl: `http://127.0.0.1:${host.port}`, workspaceId: config.workspaceId, sessionId }
  // Delay one actual SQL page after it has been read to exercise a late response.
  MemoRepository.prototype.page = function(input) {
    const page = originalPage.call(this, input)
    if (holdMore && input?.cursor) return new Promise(resolve => { release = () => resolve(page) })
    if (holdSearch && input?.query === 'search-needle') return new Promise(resolve => { releaseSearch = () => resolve(page) })
    return page
  }
  browser = await isolatedBrowser(path.join(root, 'browser'))
  await browser.command('Page.navigate', { url: web.url })
  const text = () => browser.evaluate('document.body.innerText')
  const search = async value => {
    await browser.evaluate(`(()=>{const input=document.querySelector('[aria-label="搜索备忘"]');input.focus();input.select();})()`)
    if (value) await browser.command('Input.insertText', { text: value })
    else {
      await browser.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
      await browser.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
    }
  }
  const more = () => browser.evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='加载更多').click()`)
  await until(async () => (await text()).includes('当前显示 160 条备忘'))
  assert.ok((await text()).includes('加载更多')); checks.push('真实 RPC 首次读取 160 条并显示加载更多')
  holdMore = true; await more(); await until(() => Boolean(release))
  holdSearch = true
  await search('search-needle')
  await new Promise(resolve => setTimeout(resolve, 300))
  release(); holdMore = false
  await until(() => Boolean(releaseSearch))
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.ok((await text()).includes('当前显示 160 条备忘'))
  releaseSearch(); holdSearch = false
  await until(async () => (await text()).includes('当前显示 9 条备忘'))
  assert.ok((await text()).includes('当前显示 9 条备忘'))
  assert.ok(!(await text()).includes('分页记录-'))
  checks.push('改变搜索后迟到的旧页不会覆盖或追加到新结果')
  await search(''); await until(async () => (await text()).includes('当前显示 160 条备忘'))
  await more(); await until(async () => (await text()).includes('当前显示 320 条备忘'))
  await more(); await until(async () => (await text()).includes('当前显示 435 条备忘'))
  assert.ok(!(await text()).includes('加载更多'))
  checks.push('三页加载全部 435 条，末页正确结束')
  await search('search-needle-0'); await until(async () => (await text()).includes('当前显示 1 条备忘'))
  assert.ok((await text()).includes('search-needle-0'))
  checks.push('搜索能找到原先第一页以外的最早记录')
  assert.deepEqual(browser.errors, [])
  await mkdir(evidence, { recursive: true })
  const screenshot = await browser.command('Page.captureScreenshot', { format: 'png' })
  await writeFile(path.join(evidence, 'memo-pagination-browser.png'), Buffer.from(screenshot.data, 'base64'))
  const result = { passed: true, checks, browserExceptions: browser.errors, data: 'isolated 435 synthetic notes; actual server and SQL' }
  await writeFile(path.join(evidence, 'memo-pagination-browser.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} catch (error) {
  await mkdir(evidence, { recursive: true })
  await writeFile(path.join(evidence, 'memo-pagination-browser.json'), JSON.stringify({ passed: false, checks, error: String(error),
    surface: await browser?.evaluate('document.body.innerText').catch(() => ''), browserExceptions: browser?.errors }, null, 2))
  throw error
} finally {
  release?.(); releaseSearch?.(); MemoRepository.prototype.page = originalPage
  await browser?.close(); await web?.close(); await host?.close()
  assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()))
  assert.ok(path.basename(root).startsWith('eden-memo-pagination-'))
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
