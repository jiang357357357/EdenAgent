import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from 'playwright-core'

const executablePath = process.env.EDEN_PREFERENCE_UI_BROWSER ?? process.env.EDEN_SHARED_UI_BROWSER
test('real browser: preference reads recover, reject old account replies and never replay writes', { skip: !executablePath, timeout: 45000 }, async () => {
  const root = fileURLToPath(new URL('../../frontend/web', import.meta.url))
  const output = process.env.EDEN_PREFERENCE_UI_OUTPUT ?? '.artifacts/preference-recovery'
  await mkdir(output, { recursive: true })
  const vite = await createServer({ root, cacheDir: path.resolve(output, 'node_modules/.vite-preference'), optimizeDeps: { entries: ['tests/fixtures/preference-recovery.html'] }, server: { host: '127.0.0.1', port: 0 }, plugins: [{
    name: 'isolated-preference-transport', enforce: 'pre',
    resolveId(source) { if (/(?:^|\/)rpc-transport(?:\.ts)?$/.test(source)) return path.join(root, 'tests/fixtures/preference-recovery-transport.ts') },
  }] })
  await vite.listen()
  const browser = await chromium.launch({ executablePath, headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 720 } }); page.setDefaultTimeout(10000)
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    const open = scenario => page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/tests/fixtures/preference-recovery.html?scenario=${scenario}`)
    await open('interrupted')
    await page.getByText('界面设置读取中断，正在重新连接并读取。', { exact: true }).waitFor()
    assert.equal(await page.getByText('界面设置读取中断，正在重新连接并读取。', { exact: true }).count(), 1)
    await page.getByLabel('设置就绪').filter({ hasText: '已就绪' }).waitFor()
    assert.equal(await page.getByRole('heading', { name: '操作未完成', exact: true }).count(), 0)
    assert.equal(await page.getByLabel('读取结果').textContent(), 'false / 62 / night')
    assert.equal(await page.evaluate(() => window.preferenceRecoveryFixture.calls.length), 6)
    await page.screenshot({ path: path.join(output, 'recovered.png') })
    await open('late')
    await page.getByRole('button', { name: '切换账号', exact: true }).click()
    await page.getByLabel('设置就绪').filter({ hasText: '已就绪' }).waitFor()
    assert.equal(await page.getByLabel('读取结果').textContent(), 'true / 76 / cream')
    await page.getByRole('button', { name: '结束旧读取', exact: true }).click()
    assert.equal(await page.getByLabel('读取结果').textContent(), 'true / 76 / cream')
    await open('save')
    await page.getByLabel('设置就绪').filter({ hasText: '已就绪' }).waitFor()
    await page.getByRole('button', { name: '刷新账号连接', exact: true }).click()
    await page.getByLabel('读取结果').filter({ hasText: 'true / 76 / cream' }).waitFor()
    await page.getByRole('button', { name: '保存外观', exact: true }).click()
    await page.getByText(/保存外观设置失败/).waitFor()
    await page.getByRole('button', { name: '重绘界面', exact: true }).click()
    await page.waitForTimeout(650)
    assert.equal(await page.evaluate(() => window.preferenceRecoveryFixture.calls.filter(call => call.method.endsWith('.update')).length), 1)
    await open('denied')
    await page.getByText('读取外观设置失败：没有读取外观的权限', { exact: true }).waitFor()
    await page.waitForTimeout(650)
    assert.equal(await page.evaluate(() => window.preferenceRecoveryFixture.calls.filter(call => call.method === 'ui.appearance.get').length), 1)
    assert.deepEqual(errors, [])
  } finally { await browser.close(); await vite.close() }
})
