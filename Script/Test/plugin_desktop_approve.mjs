import { readFile, writeFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const evidence = fileURLToPath(new URL('../../../.run/logs/', import.meta.url))
const fixture = JSON.parse(await readFile(path.join(evidence, 'plugin-desktop-fixture.json'), 'utf8'))
const driver = JSON.parse(await readFile(path.join(evidence, 'plugin-desktop-driver.json'), 'utf8'))
const log = path.join(evidence, 'plugin-desktop-ui-approvals.json')
const approvals = await readFile(log, 'utf8').then(JSON.parse).catch(() => [])
async function send(input) {
  const response = await fetch(driver.url, { method: 'POST', body: JSON.stringify(input), signal: AbortSignal.timeout(30000) })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error)
  return value.result
}
async function knownPlugins() {
  const ids = []
  for (const entry of await readdir(fixture.workspace, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifest = await readFile(path.join(fixture.workspace, entry.name, 'plugin.json'), 'utf8').then(JSON.parse).catch(() => null)
    if (manifest?.id) ids.push(manifest.id)
  }
  return ids
}
const deadline = Date.now() + 90000
while (Date.now() < deadline) {
  const state = await send({ action: 'evaluate', expression: `({pending:[...document.querySelectorAll('[role=group]')].filter(e=>e.textContent.includes('权限请求')).map(e=>({text:e.innerText,labelledBy:e.getAttribute('aria-labelledby')})),busy:!!document.querySelector('[aria-label="停止生成"]')})` })
  if (state.pending.length) {
    const card = state.pending[0], lines = card.text.split('\n')
    const capability = lines[lines.indexOf('权限请求') + 1], scope = lines[lines.indexOf('操作范围') + 1]
    let allowed = false
    if (['workspace.write', 'plugin.ui.inspect'].includes(capability)) {
      const relative = path.relative(fixture.workspace, path.resolve(fixture.workspace, scope))
      allowed = !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep)
    } else if (['plugin.ui.install', 'plugin.ui.enable'].includes(capability)) allowed = (await knownPlugins()).includes(scope)
    if (!allowed) { console.log(JSON.stringify({ stoppedForReview: true, capability, scope })); break }
    const selector = `[role="group"][aria-labelledby=${JSON.stringify(card.labelledBy)}] button:has-text("本次允许")`
    await send({ action: 'click', selector })
    approvals.push({ capability, scope, decision: 'once', via: 'real-client-permission-card' })
    await writeFile(log, JSON.stringify(approvals, null, 2))
    console.log(JSON.stringify(approvals.at(-1)))
  } else if (!state.busy) { console.log(JSON.stringify({ modelIdle: true, approvals: approvals.length })); break }
  await new Promise(resolve => setTimeout(resolve, 800))
}
