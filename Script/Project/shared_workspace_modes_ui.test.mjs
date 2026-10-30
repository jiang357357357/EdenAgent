import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium } from 'playwright-core'
import { selectSharingMode } from './shared_workspace_ui_helpers.mjs'

const executablePath = process.env.EDEN_SHARED_UI_BROWSER
async function preview(run, query = 'state=bound&cloud') {
  const root = fileURLToPath(new URL('../../frontend/web', import.meta.url))
  const output = path.resolve(process.env.EDEN_SHARED_UI_OUTPUT ?? '.artifacts/shared-workspace-modes-ui')
  await mkdir(output, { recursive: true })
  const vite = await createServer({ root, cacheDir: path.join(output, 'node_modules', 'vite-' + process.pid), optimizeDeps: { entries: ['tests/fixtures/shared-workspace-page.html'] }, server: { host: '127.0.0.1', port: 0 } })
  await vite.listen()
  const browser = await chromium.launch({ executablePath, headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.setDefaultTimeout(15_000)
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/tests/fixtures/shared-workspace-page.html?${query}`)
    await page.getByRole('button', { name: '选择资料库：项目资料', exact: true }).waitFor()
    try { await run(page, output) }
    catch (error) { await page.screenshot({ fullPage: true, path: path.join(output, 'modes-failure.png') }); throw error }
    assert.deepEqual(errors, [])
  } finally { await browser.close(); await vite.close() }
}
const options = { skip: !executablePath, timeout: 90_000 }

async function openCloudLocalSettings(page) {
  const library = page.getByRole('button', { name: '选择资料库：云端项目资料', exact: true })
  if (await library.count()) await library.click()
  const settings = page.getByLabel('本机同步设置', { exact: true })
  if (await settings.getAttribute('open') === null) await settings.locator('summary').click()
}

test('real browser: a legacy cloud library binds an existing remote folder without choosing a local directory', options, async () => {
  await preview(async (page, output) => {
    await selectSharingMode(page, 'cloud')
    await page.getByRole('button', { name: '资料库', exact: true }).click()
    await page.getByRole('button', { name: '选择资料库：云端项目资料', exact: true }).click()
    const source = page.getByLabel('云端共享源目录', { exact: true })
    const bind = source.getByRole('button', { name: '绑定云端源目录', exact: true })
    assert.equal(await bind.isDisabled(), true)
    await source.getByRole('button', { name: '从云主机选择源目录…', exact: true }).click()
    await source.getByRole('button', { name: 'docs', exact: true }).click()
    await source.getByRole('button', { name: '选择此云端目录', exact: true }).click()
    assert.equal(await bind.isDisabled(), true)
    await source.getByRole('checkbox', { name: /将此云端目录的文件共享/ }).check()
    await bind.click()
    await source.getByText('/srv/shared/docs', { exact: true }).waitFor()
    assert.equal(await page.locator('html').getAttribute('data-last-cloud-browse-host'), 'preview-cloud')
    assert.equal(await page.locator('html').getAttribute('data-last-bound-space'), null)
    assert.equal(await page.getByRole('button', { name: '选择本机同步目录…', exact: true }).count(), 0)
    await page.getByText('同步到这台电脑', { exact: true }).waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ fullPage: true, path: path.join(output, 'cloud-source-mobile.png') })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  })
})

test('real browser: one on/off switch toggles by keyboard, persists after reload, and restores each directory', options, async () => {
  await preview(async (page, output) => {
    const control = page.getByRole('switch', { name: '云主机共享', exact: true })
    assert.equal(await page.getByRole('switch').count(), 1)
    assert.equal(await control.getAttribute('aria-checked'), 'false')
    assert.match(await control.textContent(), /局域网共享.*OFF/)
    assert.equal(await page.getByRole('button', { name: '局域网共享', exact: true }).count(), 0)
    await page.screenshot({ animations: 'disabled', path: path.join(output, 'switch-off-desktop.png') })
    await control.focus()
    await page.keyboard.press('Space')
    await page.waitForFunction(() => document.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'true' && !document.querySelector('[role="switch"]')?.disabled)
    assert.match(await control.textContent(), /云主机共享.*ON/)
    await page.screenshot({ animations: 'disabled', path: path.join(output, 'switch-on-desktop.png') })
    await page.getByRole('button', { name: '资料库', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: '选择本机同步目录…', exact: true }).count(), 0)
    await page.reload()
    await page.waitForFunction(() => document.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'true' && !document.querySelector('[role="switch"]')?.disabled)
    await page.getByRole('button', { name: '资料库', exact: true }).click()
    await openCloudLocalSettings(page)
    await page.getByRole('button', { name: '选择本机同步目录…', exact: true }).click()
    await page.getByLabel('本机同步设置', { exact: true }).getByText('E:/Projects/共享文档', { exact: true }).waitFor({ state: 'attached' })
    await control.click()
    await page.waitForFunction(() => document.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'false' && !document.querySelector('[role="switch"]')?.disabled)
    assert.ok(await page.locator('[title]').filter({ hasText: '/workspace' }).count())
    await control.press('Enter')
    await page.waitForFunction(() => document.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'true' && !document.querySelector('[role="switch"]')?.disabled)
    await page.getByRole('button', { name: '资料库', exact: true }).click()
    await openCloudLocalSettings(page)
    await page.getByLabel('本机同步设置', { exact: true }).getByText('E:/Projects/共享文档', { exact: true }).waitFor()
    assert.equal(await control.getAttribute('data-state'), 'on')
  })
})

test('real browser: LAN and cloud separate discovery, pairing, host targets and libraries', options, async () => {
  await preview(async (page, output) => {
    assert.equal(await page.getByRole('switch', { name: '云主机共享', exact: true }).getAttribute('aria-checked'), 'false')
    assert.equal(await page.getByRole('button', { name: '选择资料库：云端项目资料', exact: true }).count(), 0)
    await page.getByRole('button', { name: '设备与配对', exact: true }).click()
    await page.getByRole('heading', { name: '局域网中发现的设备', exact: true }).waitFor()
    assert.equal(await page.getByLabel('SSH IP 或域名', { exact: true }).count(), 0)
    assert.deepEqual(await page.getByLabel('管理主机', { exact: true }).locator('option').evaluateAll(nodes => nodes.map(node => node.value)), ['preview-device'])
    await page.getByLabel('对方配对邀请').fill('eden-lan2:LAN-fixture')
    await page.getByRole('button', { name: '配对局域网设备', exact: true }).click()
    await page.waitForFunction(() => document.documentElement.dataset.lastPairMode === 'lan')
    await page.screenshot({ animations: 'disabled', path: path.join(output, 'lan-desktop.png') })
    await selectSharingMode(page, 'cloud')
    assert.equal(await page.getByText('设备已配对，请由资料库发布方授权共享权限', { exact: true }).count(), 0)
    await page.waitForFunction(() => document.querySelector('[aria-label="管理主机"]')?.value === 'preview-cloud')
    assert.equal(await page.getByRole('heading', { name: '局域网中发现的设备', exact: true }).count(), 0)
    assert.equal(await page.getByLabel('SSH IP 或域名', { exact: true }).count(), 0)
    assert.deepEqual(await page.getByLabel('管理主机', { exact: true }).locator('option').evaluateAll(nodes => nodes.map(node => node.value)), ['preview-cloud'])
    await page.getByText('云端配对设备', { exact: true }).waitFor()
    await page.locator('[data-shared-workspace-section="network"]').evaluate(element => { element.scrollTop = 0 })
    await page.screenshot({ animations: 'disabled', path: path.join(output, 'cloud-connect-desktop.png') })
    await page.getByRole('button', { name: '为所选主机创建邀请', exact: true }).click()
    assert.match(await page.getByLabel('云主机配对邀请').inputValue(), /preview-cloud/)
    await page.getByLabel('对方配对邀请').fill('eden-lan2:CLOUD-fixture')
    await page.getByRole('button', { name: '连接云主机', exact: true }).click()
    await page.waitForFunction(() => document.documentElement.dataset.lastPairMode === 'cloud')
    await page.getByRole('button', { name: '资料库', exact: true }).click()
    await page.getByRole('button', { name: '选择资料库：云端项目资料', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '选择资料库：项目资料', exact: true }).count(), 0)
    await page.getByRole('button', { name: '新建资料库', exact: true }).click()
    assert.deepEqual(await page.getByLabel('新资料库主机').locator('option').evaluateAll(nodes => nodes.map(node => node.value)), ['preview-cloud'])
    await page.getByRole('button', { name: '使用这个文件夹', exact: true }).click()
    await page.getByLabel('新资料库名称').fill('分模式云端资料')
    await page.getByRole('checkbox', { name: /确认将所选云端目录共享/ }).check()
    await page.getByRole('button', { name: '创建资料库', exact: true }).click()
    await page.getByRole('heading', { name: '分模式云端资料', exact: true }).waitFor()
    await selectSharingMode(page, 'lan')
    await page.getByRole('button', { name: '资料库', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: '选择资料库：分模式云端资料', exact: true }).count(), 0)
    assert.equal(await page.evaluate(() => document.documentElement.dataset.lastBoundSpace), undefined)
    await page.getByRole('button', { name: '选择资料库：项目资料', exact: true }).waitFor()
  })
})

test('real browser: changing sharing mode clears SSH credentials and mobile modes remain usable', options, async () => {
  await preview(async (page, output) => {
    await selectSharingMode(page, 'cloud')
    await page.getByRole('button', { name: '部署新云主机', exact: true }).click()
    await page.getByLabel('SSH 密码', { exact: true }).fill('isolated-mode-switch-secret')
    await selectSharingMode(page, 'lan')
    assert.equal(await page.getByLabel('SSH 密码', { exact: true }).count(), 0)
    await selectSharingMode(page, 'cloud')
    await page.getByRole('button', { name: '部署新云主机', exact: true }).click()
    assert.equal(await page.getByLabel('SSH 密码', { exact: true }).inputValue(), '')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('[data-shared-workspace-section="network"]').evaluate(element => { element.scrollTop = 0 })
    await page.screenshot({ animations: 'disabled', path: path.join(output, 'cloud-deploy-mobile.png') })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    await selectSharingMode(page, 'lan')
    await page.getByRole('button', { name: '设备与配对', exact: true }).click()
    await page.screenshot({ animations: 'disabled', path: path.join(output, 'lan-mobile.png') })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  })
})

test('real browser: the other sharing mode cannot operate the directory bound to a cloud library', options, async () => {
  await preview(async page => {
    await page.getByRole('button', { name: '选择资料库：项目资料', exact: true }).click()
    await page.getByText('请另选共享目录', { exact: false }).waitFor()
    await page.getByRole('button', { name: '同步状态', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: '立即同步', exact: true }).count(), 0)
    await page.getByRole('button', { name: '前往资料库', exact: true }).waitFor()
    await selectSharingMode(page, 'cloud')
    await page.getByRole('button', { name: '资料库', exact: true }).click()
    const cloudLibrary = page.getByRole('button', { name: '选择资料库：云端项目资料', exact: true })
    if (await cloudLibrary.count()) await cloudLibrary.click()
    await page.getByRole('button', { name: '同步状态', exact: true }).click()
    await page.getByRole('button', { name: '立即同步', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.dataset.lastBoundSpace), undefined)
  }, 'state=bound&cloud&cloud-bound')
})

test('real browser: a receiver without DLC can connect to a cloud host while deployment remains unavailable', options, async () => {
  await preview(async page => {
    await selectSharingMode(page, 'cloud')
    assert.equal(await page.getByRole('button', { name: '部署新云主机', exact: true }).isDisabled(), true)
    await page.getByLabel('对方配对邀请').fill('eden-lan2:receiver-fixture')
    await page.getByRole('button', { name: '连接云主机', exact: true }).click()
    await page.waitForFunction(() => document.documentElement.dataset.lastPairMode === 'cloud')
    await page.getByRole('button', { name: '资料库', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: '新建资料库', exact: true }).isDisabled(), true)
  }, 'state=unbound&cloud&receiver')
})
