import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium } from 'playwright-core'
import { selectSharingMode } from './shared_workspace_ui_helpers.mjs'

const executablePath = process.env.EDEN_SHARED_UI_BROWSER
const options = { skip: !executablePath, timeout: 45000 }
async function preview(query, work) {
  const output = path.resolve(process.env.EDEN_SHARED_UI_OUTPUT ?? '.artifacts/shared-workspace-flow')
  await mkdir(output, { recursive: true })
  const vite = await createServer({ root: fileURLToPath(new URL('../../frontend/web', import.meta.url)), cacheDir: path.join(output, 'node_modules', 'vite-' + process.pid), optimizeDeps: { entries: ['tests/fixtures/shared-workspace-page.html'] }, server: { host: '127.0.0.1', port: 0 } })
  await vite.listen()
  const browser = await chromium.launch({ executablePath, headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
    page.setDefaultTimeout(10000)
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/tests/fixtures/shared-workspace-page.html?cloud&cream&${query}`)
    await selectSharingMode(page, 'cloud')
    await page.getByRole('button', { name: '资料库', exact: true }).click()
    try { await work(page, output); assert.deepEqual(errors, []) }
    catch (error) { await page.screenshot({ path: path.join(output, 'flow-failure.png') }); throw error }
  } finally { await browser.close(); await vite.close() }
}

test('real browser: empty cloud view offers one direct workflow without local settings or blank details', options, async () => {
  await preview('empty', async (page, output) => {
    await page.getByRole('heading', { name: '还没有云端资料库', exact: true }).waitFor()
    assert.equal(await page.getByLabel('资料库详情', { exact: true }).count(), 0)
    assert.equal(await page.getByLabel('新资料库名称').count(), 0)
    assert.equal(await page.getByRole('button', { name: '选择本机同步目录…', exact: true }).count(), 0)
    assert.deepEqual(await page.getByRole('navigation', { name: '共享资料库功能' }).getByRole('button').allTextContents(), ['资料库', '云主机管理'])
    await page.screenshot({ path: path.join(output, 'empty-desktop.png') })
    await page.getByRole('button', { name: '选择云端文件夹', exact: true }).click()
    await page.getByRole('button', { name: '使用这个文件夹', exact: true }).waitFor({ state: 'visible' })
    assert.equal(await page.getByLabel('新资料库名称').count(), 0)
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('[aria-label="创建云端资料库"]')).opacity) > 0.99)
    await page.screenshot({ path: path.join(output, 'folder-desktop.png') })
    const action = await page.getByRole('button', { name: '使用这个文件夹', exact: true }).boundingBox()
    assert.ok(action && action.y + action.height < 768, 'primary action is visible on a small laptop')
    await page.getByRole('button', { name: 'docs', exact: true }).click()
    await page.getByRole('button', { name: '使用这个文件夹', exact: true }).click()
    assert.equal(await page.getByLabel('新资料库名称').inputValue(), 'docs')
    assert.equal(await page.getByRole('button', { name: '创建资料库', exact: true }).isDisabled(), true)
    await page.getByRole('checkbox', { name: /确认将所选云端目录共享/ }).check()
    await page.getByRole('button', { name: '上一步', exact: true }).click()
    await page.getByRole('button', { name: '使用这个文件夹', exact: true }).click()
    assert.equal(await page.getByRole('checkbox', { name: /确认将所选云端目录共享/ }).isChecked(), false)
    assert.equal(await page.locator('html').getAttribute('data-last-cloud-source'), null)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('[aria-label="创建云端资料库"]')).opacity) > 0.99)
    await page.screenshot({ path: path.join(output, 'confirm-mobile.png') })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.keyboard.press('Escape')
    await page.getByRole('heading', { name: '还没有云端资料库', exact: true }).waitFor()
    assert.equal(await page.locator('html').getAttribute('data-last-cloud-source'), null)
  })
})

test('real browser: failed directory reads can retry; older cloud hosts have an actionable management entry', options, async () => {
  await preview('empty&cloud-fail-once', async page => {
    await page.getByRole('button', { name: '选择云端文件夹', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '云主机暂时无法连接，请重试' }).waitFor()
    assert.equal(await page.getByRole('button', { name: '使用这个文件夹', exact: true }).isDisabled(), true)
    await page.getByRole('button', { name: '重试读取目录', exact: true }).click()
    await page.getByRole('button', { name: 'docs', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '使用这个文件夹', exact: true }).isEnabled(), true)
  })
  await preview('empty&cloud-old', async page => {
    await page.getByRole('button', { name: '选择云端文件夹', exact: true }).click()
    await page.getByRole('heading', { name: '云主机共享服务需要更新', exact: true }).waitFor()
    assert.equal(await page.locator('html').getAttribute('data-cloud-browse-count'), null)
    await page.getByRole('button', { name: '前往云主机管理', exact: true }).click()
    await page.getByRole('button', { name: '连接已有云主机', exact: true }).waitFor()
  })
})

test('real browser: switching hosts rejects late folder results and requires new consent', options, async () => {
  await preview('empty&two-clouds&cloud-delay', async page => {
    await page.getByRole('button', { name: '选择云端文件夹', exact: true }).click()
    await page.getByLabel('新资料库主机').selectOption('preview-cloud-alt')
    await page.getByRole('button', { name: '使用这个文件夹', exact: true }).click()
    await page.getByText('/srv/alternate', { exact: true }).waitFor()
    await page.getByRole('checkbox', { name: /确认将所选云端目录共享/ }).check()
    await page.getByLabel('新资料库主机').selectOption('preview-cloud')
    await page.getByRole('button', { name: '使用这个文件夹', exact: true }).click()
    await page.getByText('/srv/shared', { exact: true }).waitFor()
    assert.equal(await page.getByRole('checkbox', { name: /确认将所选云端目录共享/ }).isChecked(), false)
    assert.equal(await page.getByRole('button', { name: '创建资料库', exact: true }).isDisabled(), true)
    assert.equal(await page.locator('html').getAttribute('data-last-cloud-source'), null)
  })
})

test('real browser: a new cloud folder can cancel, retry and reject duplicates without publishing a library', options, async () => {
  await preview('empty&cloud-create-fail-once', async (page, output) => {
    await page.getByRole('button', { name: '选择云端文件夹', exact: true }).click()
    await page.getByRole('button', { name: '新建文件夹', exact: true }).click()
    await page.getByLabel('新文件夹名称').fill('已取消')
    await page.keyboard.press('Escape')
    assert.equal(await page.getByLabel('新文件夹名称').count(), 0)
    assert.equal(await page.locator('html').getAttribute('data-cloud-create-count'), null)
    await page.getByRole('button', { name: '新建文件夹', exact: true }).click()
    await page.getByLabel('新文件夹名称').fill('团队资料')
    await page.getByRole('button', { name: '创建文件夹', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '云主机暂时无法创建文件夹，请重试' }).waitFor()
    assert.equal(await page.getByLabel('新文件夹名称').inputValue(), '团队资料')
    await page.getByRole('button', { name: '创建文件夹', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[aria-label="云端绝对路径"]')?.value === '/srv/shared/团队资料')
    await page.getByRole('button', { name: '云端上级目录', exact: true }).click()
    await page.getByRole('button', { name: '新建文件夹', exact: true }).click()
    await page.getByLabel('新文件夹名称').fill('团队资料')
    await page.getByRole('button', { name: '创建文件夹', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '已存在同名文件夹或文件' }).waitFor()
    await page.getByRole('button', { name: '取消新建文件夹', exact: true }).click()
    await page.getByRole('button', { name: '团队资料', exact: true }).click()
    await page.getByRole('button', { name: '使用这个文件夹', exact: true }).click()
    assert.equal(await page.getByLabel('新资料库名称').inputValue(), '团队资料')
    assert.equal(await page.getByRole('button', { name: '创建资料库', exact: true }).isDisabled(), true)
    assert.equal(await page.locator('html').getAttribute('data-last-cloud-source'), null)
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('[aria-label="创建云端资料库"]')).opacity) > 0.99)
    await page.screenshot({ path: path.join(output, 'new-folder-confirm.png') })
  })
  await preview('empty&cloud-browse-only', async page => {
    await page.getByRole('button', { name: '选择云端文件夹', exact: true }).click()
    await page.getByRole('button', { name: '新建文件夹', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '此云主机尚不支持新建文件夹' }).waitFor()
    assert.equal(await page.locator('html').getAttribute('data-cloud-create-count'), null)
    await page.getByRole('button', { name: '取消新建文件夹', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: '使用这个文件夹', exact: true }).isEnabled(), true)
  })
})
