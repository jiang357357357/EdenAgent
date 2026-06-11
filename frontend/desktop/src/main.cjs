const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, protocol, screen, net } = require("electron")
const fs = require("node:fs")
const path = require("node:path")
const { pathToFileURL } = require("node:url")

const APP_WINDOW_TITLE = "MonAgent — AI 个人助手"
const DEFAULT_CORE_HOST = "127.0.0.1"
const DEFAULT_CORE_PORT = 40011
const DEFAULT_WEB_PORT = 40091

const agentRoot = path.resolve(__dirname, "../../..")
const quitFlag = resolveMonConfigPath("desktop", "QUIT_FLAG", ".artifacts/desktop-quit.flag")
let mainWindow = null
let tray = null
let isQuitting = false
let currentViewMode = "chatWithCharacter"

protocol.registerSchemesAsPrivileged([
  {
    scheme: "monagent-file",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8")
  } catch {
    return ""
  }
}

function parseMonConfigValue(contents, targetSection, targetKey) {
  let section = "default"
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1).trim().toLowerCase()
      continue
    }
    const equalsIndex = line.indexOf("=")
    if (equalsIndex < 0) continue
    const key = line.slice(0, equalsIndex).trim().toUpperCase()
    const value = line.slice(equalsIndex + 1).trim()
    if (section === targetSection.toLowerCase() && key === targetKey.toUpperCase()) {
      return value
    }
  }
  return undefined
}

function readAgentConfig() {
  return readText(path.join(agentRoot, ".monconfig"))
}

function getAgentConfig(section, key, fallback) {
  return parseMonConfigValue(readAgentConfig(), section, key) ?? fallback
}

function resolveMonConfigPath(section, key, fallback) {
  const value = getAgentConfig(section, key, fallback)
  return path.isAbsolute(value) ? value : path.join(agentRoot, value)
}

function findMonRootFrom(start) {
  let current = start
  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "Backend", "Server", ".monconfig"))) {
      return current
    }
    current = path.dirname(current)
  }
  return undefined
}

function findMonRoot() {
  return findMonRootFrom(agentRoot) ?? findMonRootFrom(process.cwd())
}

function resolveCoreBaseUrl() {
  const explicit = process.env.MONCORE_CORE_BASE_URL?.trim()
  if (explicit) return explicit.replace(/\/$/, "")

  const root = findMonRoot()
  if (!root) {
    throw new Error("未找到 Mon 工作区根目录，无法定位 Backend/Server/.monconfig")
  }

  const configPath = path.join(root, "Backend", "Server", ".monconfig")
  const contents = readText(configPath)
  if (!contents) {
    throw new Error(`读取 MonCore 配置失败: ${configPath}`)
  }

  const host = parseMonConfigValue(contents, "server", "HOST") ?? DEFAULT_CORE_HOST
  const port = Number(parseMonConfigValue(contents, "server", "PORT") ?? DEFAULT_CORE_PORT)
  const normalizedHost = host === "0.0.0.0" || host === "::" ? DEFAULT_CORE_HOST : host
  return `http://${normalizedHost}:${Number.isFinite(port) ? port : DEFAULT_CORE_PORT}`
}

function getDevAccount() {
  const username = getAgentConfig("auth_dev", "USERNAME", "")
  const password = getAgentConfig("auth_dev", "PASSWORD", "")
  if (!username || !password) return null
  return { username, password }
}

async function parseCoreError(response) {
  const status = response.status
  const text = await response.text().catch(() => "")
  try {
    const data = JSON.parse(text)
    return data.error || data.message || `${status} ${response.statusText}`
  } catch {
    return text || `${status} ${response.statusText}`
  }
}

async function coreRequest(endpoint, init = {}) {
  const baseUrl = resolveCoreBaseUrl()
  const started = Date.now()
  const response = await fetch(`${baseUrl}${endpoint}`, init).catch((error) => {
    console.error(`[MonAgent][CoreBridge][ERROR] ${init.method ?? "GET"} ${endpoint} failed: ${error}`)
    throw new Error(`请求 MonCore 接口失败: ${error.message || error}`)
  })

  console.log(
    `[MonAgent][CoreBridge][INFO] ${init.method ?? "GET"} ${endpoint} -> ${response.status} ${Date.now() - started}ms`,
  )

  if (!response.ok) {
    throw new Error(await parseCoreError(response))
  }

  return response.json()
}

function authHeader(token) {
  return { Authorization: `Token ${token}` }
}

function jsonPost(body) {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }
}

function clamp(value, min, max) {
  const withMin = typeof min === "number" ? Math.max(value, min) : value
  return typeof max === "number" ? Math.min(withMin, max) : withMin
}

function setWindowSize(request = {}) {
  if (!mainWindow) return true
  const display = screen.getDisplayMatching(mainWindow.getBounds())
  const workArea = display.workAreaSize
  let width = typeof request.width === "number" ? request.width : undefined
  let height = typeof request.height === "number" ? request.height : undefined

  if (typeof width !== "number" && typeof request.widthRatio === "number") {
    width = workArea.width * request.widthRatio
  }
  if (typeof height !== "number" && typeof request.heightRatio === "number") {
    height = workArea.height * request.heightRatio
  }

  width ??= 960
  height ??= 540
  height = clamp(height, request.minHeight, request.maxHeight)
  if (typeof request.aspectRatio === "number") {
    width = height * request.aspectRatio
  }
  width = clamp(width, request.minWidth, request.maxWidth)

  mainWindow.setMinimumSize(Math.max(1, Math.round(request.minWidth ?? 1)), Math.max(1, Math.round(request.minHeight ?? 1)))
  mainWindow.setMaximumSize(
    Math.max(1, Math.round(request.maxWidth ?? 100000)),
    Math.max(1, Math.round(request.maxHeight ?? 100000)),
  )
  mainWindow.setSize(Math.round(width), Math.round(height), true)
  if (request.center !== false) mainWindow.center()
  return true
}

function setWindowAppearance(mode) {
  if (!mainWindow) return true
  const character = mode === "character"
  mainWindow.setBackgroundColor(character ? "#00000000" : "#f5f5f4")
  mainWindow.setHasShadow(!character)
  return true
}

function sendViewMode(mode) {
  currentViewMode = mode === "character" ? "character" : "chatWithCharacter"
  mainWindow?.show()
  mainWindow?.webContents.send("mon-agent-view-mode", currentViewMode)
  updateTray()
}

function createWindow() {
  const webPort = Number(getAgentConfig("server", "WEB_PORT", String(DEFAULT_WEB_PORT)))
  const devUrl = `http://127.0.0.1:${Number.isFinite(webPort) ? webPort : DEFAULT_WEB_PORT}`
  const preload = path.join(__dirname, "preload.cjs")
  const icon = path.join(__dirname, "..", "assets", "icon.ico")

  mainWindow = new BrowserWindow({
    title: APP_WINDOW_TITLE,
    width: 960,
    height: 540,
    minWidth: 1,
    minHeight: 1,
    center: true,
    show: false,
    frame: true,
    titleBarStyle: "default",
    autoHideMenuBar: true,
    transparent: false,
    backgroundColor: "#f5f5f4",
    icon: fs.existsSync(icon) ? icon : undefined,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
    },
  })

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show()
  })
  mainWindow.on("close", (event) => {
    if (!isQuitting && !hasQuitFlag()) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(agentRoot, "frontend", "web", "dist", "index.html"))
  } else {
    mainWindow.loadURL(devUrl)
  }
}

function hasQuitFlag() {
  return fs.existsSync(quitFlag)
}

function createFallbackTrayIcon() {
  const size = 32
  const canvas = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - 15.5
      const dy = y - 15.5
      const distance = Math.sqrt(dx * dx + dy * dy)
      const inside = distance <= 14
      const ring = distance >= 9.5 && distance <= 12.5
      const offset = (y * size + x) * 4
      const rgba = !inside ? [0, 0, 0, 0] : ring ? [255, 148, 28, 255] : [24, 24, 27, 255]
      canvas[offset] = rgba[2]
      canvas[offset + 1] = rgba[1]
      canvas[offset + 2] = rgba[0]
      canvas[offset + 3] = rgba[3]
    }
  }
  return nativeImage.createFromBitmap(canvas, { width: size, height: size })
}

function updateTray() {
  if (!tray) return
  const nextMode = currentViewMode === "character" ? "切换到三栏模式" : "切换到桌宠模式"
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示窗口", click: () => mainWindow?.show() },
      { label: "隐藏到托盘", click: () => mainWindow?.hide() },
      { type: "separator" },
      {
        label: nextMode,
        click: () => sendViewMode(currentViewMode === "character" ? "chatWithCharacter" : "character"),
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          isQuitting = true
          app.quit()
        },
      },
    ]),
  )
}

function createTray() {
  const iconPath = path.join(__dirname, "..", "assets", "icon.ico")
  const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : createFallbackTrayIcon()
  tray = new Tray(icon)
  tray.setToolTip(APP_WINDOW_TITLE)
  tray.on("click", () => mainWindow?.show())
  updateTray()
}

function registerFileProtocol() {
  protocol.handle("monagent-file", (request) => {
    const url = new URL(request.url)
    let filePath = decodeURIComponent(url.pathname)
    if (process.platform === "win32" && /^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1)
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

ipcMain.handle("mon-agent:invoke", async (_event, command, args = {}) => {
  switch (command) {
    case "resolve_core_base_url_command":
      return resolveCoreBaseUrl()
    case "get_dev_account":
      return getDevAccount()
    case "core_login":
      return coreRequest("/api/users/login/", jsonPost({
        username: args.request?.username,
        password: args.request?.password,
        client_id: args.request?.clientId ?? args.request?.client_id ?? "",
        client_type: args.request?.clientType ?? args.request?.client_type ?? "",
      }))
    case "core_verify_token":
      return coreRequest("/api/users/verify-token/", { method: "GET", headers: authHeader(args.token) })
    case "core_default_assistant":
      return coreRequest("/api/assistants/default/", { method: "GET", headers: authHeader(args.token) })
    case "core_user_profile":
      return coreRequest("/api/users/me/profile/", { method: "GET", headers: authHeader(args.token) })
    case "core_logout":
      return coreRequest("/api/users/logout/", { method: "POST", headers: authHeader(args.token) })
    case "set_window_size":
      return setWindowSize(args.request ?? {})
    case "set_window_appearance":
      return setWindowAppearance(args.mode)
    case "set_view_mode_state":
      currentViewMode = args.mode === "character" ? "character" : "chatWithCharacter"
      updateTray()
      return true
    case "start_window_drag":
      return true
    default:
      throw new Error(`未知桌面命令: ${command}`)
  }
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
app.on("second-instance", () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    registerFileProtocol()
    createWindow()
    createTray()
  })

  app.on("before-quit", () => {
    isQuitting = true
  })

  app.on("window-all-closed", (event) => {
    event.preventDefault()
  })
}
