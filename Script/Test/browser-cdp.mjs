import { spawn } from 'node:child_process'
import { readFile, access } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/** Headless browser in an explicitly isolated temporary profile; never attaches to user windows. */
export async function isolatedBrowser(profile) {
  const candidates = [process.env.EDEN_TEST_BROWSER,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean)
  let executable
  for (const candidate of candidates) { try { await access(candidate); executable = candidate; break } catch {} }
  if (!executable) throw new Error('Set EDEN_TEST_BROWSER to a Chromium executable for the browser smoke')
  const processHandle = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--site-per-process', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  let port
  await until(async () => {
    try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); return port > 0 }
    catch { if (processHandle.exitCode !== null) throw new Error('Browser exited before opening its test endpoint'); return false }
  })
  return connectBrowser(port,()=>until(()=>processHandle.exitCode!==null,5000).catch(()=>processHandle.kill()))
}
export async function connectBrowser(port, closeProcess) {
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let sequence = 0
  const pending = new Map()
  const errors = []
  socket.onmessage = event => {
    const value = JSON.parse(String(event.data))
    if (value.method === 'Runtime.exceptionThrown') errors.push(value.params.exceptionDetails.exception?.description ?? value.params.exceptionDetails.text)
    const request = pending.get(value.id)
    if (!request) return
    pending.delete(value.id); clearTimeout(request.timer)
    if (value.error) request.reject(new Error(value.error.message)); else request.resolve(value.result)
  }
  function command(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++sequence
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)) }, 30_000)
      pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }
  await command('Runtime.enable')
  await command('Page.enable')
  await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  return {
    errors, command,
    async evaluate(expression) {
      const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
      return result.result.value
    },
    async close() {
      try { socket.send(JSON.stringify({ id: ++sequence, method: 'Browser.close' })) } catch {}
      for (const value of pending.values()) { clearTimeout(value.timer); value.reject(new Error('Browser closed')) }
      pending.clear(); socket.close()
      await closeProcess()
    },
  }
}
export async function until(predicate, timeout = 30_000) {
  const deadline = Date.now() + timeout
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('Browser condition timed out')
    await delay(50)
  }
}
