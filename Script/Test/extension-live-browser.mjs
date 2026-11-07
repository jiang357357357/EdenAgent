import assert from 'node:assert/strict'
import { until } from './browser-cdp.mjs'

export function liveExtensionBrowser(browser, pluginId) {
  const sessions = new Map()
  async function frame(expression) {
    try {
      const targets = (await browser.command('Target.getTargets')).targetInfos.filter(target => target.type === 'iframe')
      const target = targets.at(-1)
      let result
      if (target) {
        if (!sessions.has(target.targetId)) {
          sessions.set(target.targetId, (await browser.command('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId)
          await browser.command('Runtime.enable', {}, sessions.get(target.targetId))
        }
        result = await browser.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessions.get(target.targetId))
      } else {
        const id = (await browser.command('Page.getFrameTree')).frameTree.childFrames?.at(-1)?.frame.id
        if (!id) return undefined
        const world = await browser.command('Page.createIsolatedWorld', { frameId: id, worldName: 'live-extension-acceptance' })
        result = await browser.command('Runtime.evaluate', { expression, contextId: world.executionContextId, awaitPromise: true, returnByValue: true })
      }
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
      return result.result.value
    } catch (error) {
      if (/No frame|No target|Session closed|Cannot find context|Inspected target navigated/.test(String(error))) return undefined
      throw error
    }
  }
  const call = (method, input) => browser.evaluate(`window.__call(${JSON.stringify(method)},${JSON.stringify(input)})`)
  async function open(title) {
    await until(() => browser.evaluate('Boolean(document.querySelector("[aria-label=打开应用扩展]"))'))
    await browser.evaluate('document.querySelector("[aria-label=打开应用扩展]").click()')
    await until(() => browser.evaluate(`[...document.querySelectorAll('[aria-label=应用扩展] button')].some(item=>item.querySelector('strong')?.textContent===${JSON.stringify(title)})`))
    await browser.evaluate(`[...document.querySelectorAll('[aria-label=应用扩展] button')].find(item=>item.querySelector('strong')?.textContent===${JSON.stringify(title)}).click()`)
  }
  async function click(action, marker) {
    const selector = `[data-action="${action}"]`
    const expression = marker ? `[...document.querySelectorAll('[data-task-id]')].find(item=>item.textContent.includes(${JSON.stringify(marker)}))?.querySelector(${JSON.stringify(selector)})`
      : `document.querySelector(${JSON.stringify(selector)})`
    await until(() => frame(`Boolean(${expression}&&!${expression}.disabled)`))
    await frame(`${expression}.click()`)
  }
  async function title(value) {
    await frame(`(()=>{const input=document.querySelector('[aria-label=待办标题]');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  }
  async function crud(marker, checks) {
    await open('自主扩展待办')
    await until(() => frame('Boolean(document.querySelector("[aria-label=待办标题]"))'))
    await title(marker); await click('add')
    await until(() => frame(`[...document.querySelectorAll('[data-task-id]')].filter(item=>item.textContent.includes(${JSON.stringify(marker)})).length===1`))
    checks.push('真实模型编写的页面可新增待办，后端只保存一条')
    await click('toggle', marker)
    await until(() => frame(`[...document.querySelectorAll('[data-task-id]')].some(item=>item.textContent.includes(${JSON.stringify(marker)})&&item.textContent.includes('已完成'))`))
    checks.push('页面完成操作更新真实业务状态')
    const removed = marker + '_DELETE'
    await title(removed); await click('add')
    await until(() => frame(`[...document.querySelectorAll('[data-task-id]')].some(item=>item.textContent.includes(${JSON.stringify(removed)}))`))
    await click('delete', removed)
    await until(() => frame(`![...document.querySelectorAll('[data-task-id]')].some(item=>item.textContent.includes(${JSON.stringify(removed)}))`))
    const total = await frame('document.querySelectorAll("[data-task-id]").length')
    checks.push('页面删除操作实际生效')
    await open('自主扩展任务树')
    await until(() => browser.evaluate('Boolean(document.querySelector("[role=tree]"))'))
    for (let level = 0; level < 5; level++) {
      if (await browser.evaluate(`document.querySelector('[role=tree]').textContent.includes(${JSON.stringify(marker)})`)) break
      const expanded = await browser.evaluate(`(()=>{const buttons=[...document.querySelectorAll('[role=tree] [aria-expanded=false] > div > button')];buttons.forEach(button=>button.click());return buttons.length})()`)
      if (!expanded) break
      await until(() => browser.evaluate(`document.querySelector('[role=tree]').textContent.includes(${JSON.stringify(marker)})||![...document.querySelectorAll('[role=status]')].some(item=>item.textContent.includes('正在读取'))`))
    }
    await until(() => browser.evaluate(`Boolean(document.querySelector('[role=tree]'))&&document.querySelector('[role=tree]').textContent.includes(${JSON.stringify(marker)})`))
    checks.push('原生树形视图读取与页面一致的后端数据')
    const modules = await call('plugin.ui.list', {}), module = modules.modules.find(item => item.pluginId === pluginId)
    assert.ok(module?.document.apiVersion === 2)
    const command = module.document.contributes.commands.find(item => item.id === 'refresh')
    assert.ok(command, 'Model omitted required refresh command')
    const titleText = module.pluginName + '：' + command.title
    await until(() => browser.evaluate(`Boolean(document.querySelector('[aria-label='+CSS.escape(${JSON.stringify(titleText)})+']'))`))
    await browser.evaluate(`document.querySelector('[aria-label='+CSS.escape(${JSON.stringify(titleText)})+']').click()`)
    await until(() => browser.evaluate(`document.querySelector('.workbench-status')?.textContent.includes('待办')&&document.querySelector('.workbench-status').textContent.includes(${JSON.stringify(String(total))})`))
    checks.push('模型注册的工具栏命令和状态栏在工作台可用')
    return module
  }
  return { frame, call, open, click, title, crud }
}
