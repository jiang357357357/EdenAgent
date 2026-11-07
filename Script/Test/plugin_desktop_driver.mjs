import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile, writeFile, access, mkdir, rm, realpath } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { EdenAgentRpcClient } from '../../frontend/web/src/lib/rpc-client.ts'

const agent = fileURLToPath(new URL('../../', import.meta.url))
const evidence = path.resolve(agent, '../.run/logs')
const fixture = JSON.parse(await readFile(path.join(evidence, 'plugin-desktop-fixture.json'), 'utf8'))
const quitFlag = path.join(fixture.root, 'desktop.quit')
const environment = { ...process.env, MON_WORKSPACE_ROOT: fixture.root, EDEN_AGENT_ROOT: fixture.agentRoot,
  EDEN_AGENT_ALLOW_MULTIPLE_INSTANCES: 'true', EDEN_AGENT_EXTERNAL_ORIGINS: 'mon', EDEN_AGENT_SERVER_MODE: '',
  EDEN_AGENT_MON_PORT: String(fixture.monPort), EDEN_AGENT_LOCAL_PORT: String(fixture.localPort),
  EDEN_AGENT_MON_DATA_ROOT: path.join(fixture.root, 'Data/Agent/realms/mon'),
  EDEN_AGENT_LOCAL_DATA_ROOT: path.join(fixture.root, 'Data/Agent/realms/local'),
  EDEN_AGENT_MON_CAPABILITY_TOKEN: randomBytes(32).toString('hex'),
  EDEN_AGENT_DESKTOP_QUIT_FLAG: quitFlag }
delete environment.ELECTRON_RUN_AS_NODE; delete environment.NODE_OPTIONS
await mkdir(path.join(fixture.root, 'Config/Os'), { recursive: true })
await writeFile(path.join(fixture.root, 'Config/Os/.monconfig'), '[mcp]\nSERVER_PORT=0\n')
let child, browser, page, client, endpoint, nativeTail = '', sequence = 0
const pageErrors = [], actions = []
async function launch() {
  nativeTail = ''; await rm(quitFlag, { force: true })
  child = spawn(path.join(fixture.app, 'eden-agent.exe'), ['--remote-debugging-port=0'], {
    cwd: fixture.root, env: environment, windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'],
  })
  endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Desktop startup timeout: ${nativeTail.slice(-3000)}`)), 60000)
    const read = bytes => {
      nativeTail = (nativeTail + bytes).slice(-16000)
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(nativeTail)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    }
    child.stdout.on('data', read); child.stderr.on('data', read)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Desktop exited ${code}: ${nativeTail.slice(-3000)}`)) })
  })
  const address = new URL(endpoint), committed = Date.now() + 60000
  while (true) {
    const targets = await fetch(`http://${address.host}/json/list`).then(response => response.json())
    if (targets.some(item => item.url?.startsWith('edenagent:') && !new URL(item.url).searchParams.get('page'))) break
    if (Date.now() > committed) throw new Error('Desktop did not commit its main document')
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  // Attaching while Electron installs sandboxed preload bindings can corrupt startupData.
  // Match the production-artifact test driver: attach after the committed document settles.
  await new Promise(resolve => setTimeout(resolve, 1500))
  browser = await chromium.connectOverCDP(endpoint)
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    page = browser.contexts()[0].pages().find(item => item.url().startsWith('edenagent:') && !new URL(item.url()).searchParams.get('page'))
    if (page) break
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  if (!page) throw new Error('Packaged main document was not opened')
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => typeof window.edenAgentDesktop?.getAgentCapability === 'function')
  const backendDeadline = Date.now() + 60000
  while (true) {
    const health = await fetch(`http://127.0.0.1:${fixture.localPort}/healthz`, { signal: AbortSignal.timeout(500) }).then(response => response.json()).catch(() => null)
    if (health?.runtimeOrigin === 'local') break
    if (Date.now() > backendDeadline) throw new Error(`Desktop backend did not become ready: ${nativeTail.slice(-1500)}`)
    await new Promise(resolve => setTimeout(resolve, 200))
  }
}
async function stop() {
  client?.close(); client = undefined
  if (!child || child.exitCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  await writeFile(quitFlag, 'quit')
  await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('Desktop shutdown timed out')), 25000).unref())])
  await browser?.close().catch(() => {})
}
async function rpc(method, params = {}) {
  if (!client) {
    const tokenPath = path.join(environment.EDEN_AGENT_LOCAL_DATA_ROOT, 'capability.token')
    await access(tokenPath)
    const next = new EdenAgentRpcClient()
    await next.connect(`ws://127.0.0.1:${fixture.localPort}/rpc`, (await readFile(tokenPath, 'utf8')).trim(), 'desktop-acceptance', 'local')
    client = next
    next.onClose(() => { if (client === next) client = undefined })
  }
  return client.request(method, params)
}
async function observe() {
  return { title: await page.title(), url: page.url(), text: (await page.locator('body').innerText()).slice(-14000),
    buttons: await page.locator('button:visible').evaluateAll(elements => elements.map(item => ({ text: item.innerText, label: item.getAttribute('aria-label'), title: item.title, disabled: item.disabled }))),
    inputs: await page.locator('input:visible,textarea:visible,select:visible').evaluateAll(elements => elements.map(item => ({ tag: item.tagName, type: item.type, placeholder: item.placeholder, label: item.getAttribute('aria-label'), value: item.type === 'password' || /api.?key|token|secret|credential/i.test(`${item.placeholder ?? ''} ${item.getAttribute('aria-label') ?? ''}`) ? '[redacted]' : item.value }))),
    pageErrors }
}
function target(input) {
  return input.selector ? page.locator(input.selector) : page.getByRole(input.role ?? 'button', { name: input.name, exact: input.exact ?? true })
}
await launch()
const control = createServer(async (request, response) => {
  try {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const input = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    let result
    if (input.action === 'observe') result = await observe()
    else if (input.action === 'rpc') result = await rpc(input.method, input.params)
    else if (input.action === 'click') {
      if (input.confirm) page.once('dialog', dialog => { void dialog.accept() })
      await target(input).click(); result = await observe()
    }
    else if (input.action === 'fill') { await target(input).fill(input.text); result = await observe() }
    else if (input.action === 'press') { await target(input).press(input.key); result = await observe() }
    else if (input.action === 'check') { await target(input).setChecked(input.checked ?? true); result = await observe() }
    else if (input.action === 'select') { await target(input).selectOption(input.value); result = await observe() }
    else if (input.action === 'restart') { await stop(); await launch(); await driverMetadata(); result = await observe() }
    else if (input.action === 'stop') { await stop(); result = { stopped: true } }
    else if (input.action === 'cleanup') {
      await stop()
      const resolved = await realpath(fixture.root)
      if (path.dirname(resolved).toLowerCase() !== (await realpath(tmpdir())).toLowerCase() || !path.basename(resolved).startsWith('eden-plugin-desktop-')) throw new Error('Refusing cleanup outside temporary fixture')
      await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      result = { cleaned: true }; response.on('finish', () => control.close(() => process.exit(0)))
    }
    else if (input.action === 'evaluate') result = await page.evaluate(input.expression)
    else if (input.action === 'viewport') {
      const session = await page.context().newCDPSession(page)
      try {
        await session.send(input.width ? 'Emulation.setDeviceMetricsOverride' : 'Emulation.clearDeviceMetricsOverride',
          input.width ? { width: input.width, height: input.height ?? 800, deviceScaleFactor: 1, mobile: false } : {})
      } finally { await session.detach() }
      await page.waitForTimeout(250)
      result = { viewport: await page.evaluate('({width:innerWidth,height:innerHeight})') }
    }
    else if (input.action === 'screenshot') {
      if (!/^[a-z0-9-]+$/.test(input.name)) throw new Error('Invalid evidence name')
      const file = path.join(evidence, `plugin-desktop-${input.name}.png`)
      const privateFields = page.locator('input[type="password"],input[placeholder*="API Key" i],input[placeholder*="token" i]')
      if (await privateFields.count()) await page.screenshot({ path: file, mask: [privateFields] })
      else {
        const session = await page.context().newCDPSession(page)
        try {
          const captured = await session.send('Page.captureScreenshot', { format: 'png', fromSurface: false, captureBeyondViewport: false })
          await writeFile(file, Buffer.from(captured.data, 'base64'))
        } finally { await session.detach() }
      }
      result = { file }
    } else if (input.action === 'native') result = { log: nativeTail.slice(-4000) }
    else throw new Error('Unknown test driver action')
    actions.push({ sequence: ++sequence, action: input.action, method: input.method, name: input.name, selector: input.selector })
    await writeFile(path.join(evidence, 'plugin-desktop-actions.json'), JSON.stringify(actions, null, 2))
    response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.end(JSON.stringify({ result }))
  } catch (error) { response.statusCode = 400; response.end(JSON.stringify({ error: error.message })) }
})
await new Promise(resolve => control.listen(0, '127.0.0.1', resolve))
async function driverMetadata() {
  await writeFile(path.join(evidence, 'plugin-desktop-driver.json'), JSON.stringify({ url: `http://127.0.0.1:${control.address().port}`, pid: child.pid, driverPid: process.pid, root: fixture.root }, null, 2))
}
await driverMetadata()
console.log('Packaged Electron client and acceptance driver ready')

