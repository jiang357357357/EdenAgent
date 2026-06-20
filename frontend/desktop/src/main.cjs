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
const petSettingsPath = resolveMonConfigPath("desktop", "PET_SETTINGS", ".artifacts/desktop-pet-settings.json")
const DEFAULT_PET_SETTINGS = {
  alwaysOnTop: true,
  transparentWindow: true,
  clickThrough: false,
  characterDraggable: false,
  showInput: true,
  notifyOnWake: false,
  petScale: 100,
  windowOpacity: 92,
  inputOpacity: 78,
  dock: "center",
  inputMode: "compact",
  inputWidth: 78,
  inputHeight: 20,
  windowX: null,
  windowY: null,
}
let mainWindow = null
let petWindow = null
let settingsWindow = null
let tray = null
let isQuitting = false
let currentViewMode = "chatWithCharacter"
let petSettings = readPetSettings()
let applyingPetBounds = false
let savePetPositionTimer = null

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

function clampNumber(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return clamp(number, min, max)
}

function normalizePetSettings(input = {}) {
  const windowX = Number(input.windowX)
  const windowY = Number(input.windowY)
  return {
    alwaysOnTop: Boolean(input.alwaysOnTop ?? DEFAULT_PET_SETTINGS.alwaysOnTop),
    transparentWindow: Boolean(input.transparentWindow ?? DEFAULT_PET_SETTINGS.transparentWindow),
    clickThrough: Boolean(input.clickThrough ?? DEFAULT_PET_SETTINGS.clickThrough),
    characterDraggable: Boolean(input.characterDraggable ?? DEFAULT_PET_SETTINGS.characterDraggable),
    showInput: Boolean(input.showInput ?? DEFAULT_PET_SETTINGS.showInput),
    notifyOnWake: Boolean(input.notifyOnWake ?? DEFAULT_PET_SETTINGS.notifyOnWake),
    petScale: clampNumber(input.petScale, DEFAULT_PET_SETTINGS.petScale, 70, 140),
    windowOpacity: clampNumber(input.windowOpacity, DEFAULT_PET_SETTINGS.windowOpacity, 40, 100),
    inputOpacity: clampNumber(input.inputOpacity, DEFAULT_PET_SETTINGS.inputOpacity, 30, 95),
    dock: ["left", "center", "right"].includes(input.dock) ? input.dock : DEFAULT_PET_SETTINGS.dock,
    inputMode: ["compact", "panel", "hidden"].includes(input.inputMode) ? input.inputMode : DEFAULT_PET_SETTINGS.inputMode,
    inputWidth: clampNumber(input.inputWidth, DEFAULT_PET_SETTINGS.inputWidth, 10, 100),
    inputHeight: clampNumber(input.inputHeight, DEFAULT_PET_SETTINGS.inputHeight, 12, 32),
    windowX: Number.isFinite(windowX) ? windowX : null,
    windowY: Number.isFinite(windowY) ? windowY : null,
  }
}

function readPetSettings() {
  try {
    const raw = fs.readFileSync(petSettingsPath, "utf8")
    return normalizePetSettings({ ...DEFAULT_PET_SETTINGS, ...JSON.parse(raw) })
  } catch {
    return { ...DEFAULT_PET_SETTINGS }
  }
}

function writePetSettings(settings) {
  fs.mkdirSync(path.dirname(petSettingsPath), { recursive: true })
  fs.writeFileSync(petSettingsPath, JSON.stringify(settings, null, 2), "utf8")
}

function petWindowBounds() {
  if (!petWindow) return undefined
  const currentBounds = petWindow.getBounds()
  const display = screen.getDisplayMatching(currentBounds)
  const workArea = display.workArea
  const scale = petSettings.petScale / 100
  const characterHeight = Math.round(clamp(workArea.height * 0.5 * scale, 260, workArea.height))
  const inputRatio = petSettings.showInput ? petSettings.inputHeight / 100 : 0
  const layoutGapRatio = petSettings.showInput ? 0.06 : 0
  const height = Math.round(characterHeight / Math.max(0.12, 1 - inputRatio - layoutGapRatio))
  const width = Math.round(height * (7 / 16))
  const margin = 16
  const previousHeight = currentBounds.height > 1 ? currentBounds.height : height
  const fallbackX =
    petSettings.dock === "left"
      ? workArea.x + margin
      : petSettings.dock === "right"
        ? workArea.x + workArea.width - width - margin
        : workArea.x + Math.round((workArea.width - width) / 2)
  const fallbackY = workArea.y + workArea.height - height - margin
  const x = Number.isFinite(Number(petSettings.windowX)) ? Math.round(Number(petSettings.windowX)) : fallbackX
  const storedY = Number.isFinite(Number(petSettings.windowY)) ? Math.round(Number(petSettings.windowY)) : fallbackY
  const y = storedY - (height - previousHeight)
  return { x, y, width, height }
}

function applyPetWindowAttributes() {
  if (!petWindow) return

  petWindow.setAlwaysOnTop(petSettings.alwaysOnTop)
  petWindow.setIgnoreMouseEvents(petSettings.clickThrough, { forward: true })
  petWindow.setOpacity(1)
  petWindow.setBackgroundColor(petSettings.transparentWindow ? "#00000000" : "#f5f5f4")
  petWindow.setHasShadow(!petSettings.transparentWindow)
}

function applyPetWindowBounds() {
  if (!petWindow) return

  const bounds = petWindowBounds()
  if (bounds) {
    petWindow.setMinimumSize(1, 1)
    petWindow.setMaximumSize(100000, 100000)
    applyingPetBounds = true
    petWindow.setBounds(bounds, true)
    petSettings = normalizePetSettings({ ...petSettings, windowX: bounds.x, windowY: bounds.y })
    writePetSettings(petSettings)
    setTimeout(() => {
      applyingPetBounds = false
    }, 250)
  }
}

function applyPetWindowSettings() {
  applyPetWindowAttributes()
  applyPetWindowBounds()
}

function savePetWindowPosition() {
  if (!petWindow || applyingPetBounds) return
  if (savePetPositionTimer) clearTimeout(savePetPositionTimer)
  savePetPositionTimer = setTimeout(() => {
    savePetPositionTimer = null
    if (!petWindow || applyingPetBounds) return
    const bounds = petWindow.getBounds()
    petSettings = normalizePetSettings({ ...petSettings, windowX: bounds.x, windowY: bounds.y })
    writePetSettings(petSettings)
    broadcastPetSettings()
  }, 180)
}

function broadcastPetSettings() {
  mainWindow?.webContents.send("mon-agent-pet-settings", petSettings)
  petWindow?.webContents.send("mon-agent-pet-settings", petSettings)
  settingsWindow?.webContents.send("mon-agent-pet-settings", petSettings)
}

function updatePetSettings(input) {
  const previousSettings = petSettings
  petSettings = normalizePetSettings({ ...petSettings, ...(input ?? {}) })
  writePetSettings(petSettings)
  applyPetWindowAttributes()
  if (
    previousSettings.petScale !== petSettings.petScale ||
    previousSettings.dock !== petSettings.dock ||
    previousSettings.showInput !== petSettings.showInput ||
    previousSettings.inputHeight !== petSettings.inputHeight ||
    previousSettings.windowX !== petSettings.windowX ||
    previousSettings.windowY !== petSettings.windowY
  ) {
    applyPetWindowBounds()
  }
  broadcastPetSettings()
  return petSettings
}

function setWindowSize(request = {}, targetWindow = mainWindow) {
  if (!targetWindow) return true
  if (request.mode === "character" || request.pet === true) {
    const bounds = petWindowBounds()
    if (bounds) {
      petWindow.setMinimumSize(1, 1)
      petWindow.setMaximumSize(100000, 100000)
      applyingPetBounds = true
      petWindow.setBounds(bounds, true)
      petSettings = normalizePetSettings({ ...petSettings, windowX: bounds.x, windowY: bounds.y })
      writePetSettings(petSettings)
      setTimeout(() => {
        applyingPetBounds = false
      }, 250)
    }
    return true
  }
  const display = screen.getDisplayMatching(targetWindow.getBounds())
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

  targetWindow.setMinimumSize(Math.max(1, Math.round(request.minWidth ?? 1)), Math.max(1, Math.round(request.minHeight ?? 1)))
  targetWindow.setMaximumSize(
    Math.max(1, Math.round(request.maxWidth ?? 100000)),
    Math.max(1, Math.round(request.maxHeight ?? 100000)),
  )
  targetWindow.setSize(Math.round(width), Math.round(height), true)
  if (request.center !== false) targetWindow.center()
  return true
}

function setWindowAppearance(mode, targetWindow = mainWindow) {
  if (!targetWindow) return true
  const character = mode === "character"
  if (character) {
    applyPetWindowSettings()
  } else {
    targetWindow.setAlwaysOnTop(false)
    targetWindow.setIgnoreMouseEvents(false)
    targetWindow.setOpacity(1)
    targetWindow.setBackgroundColor("#f5f5f4")
    targetWindow.setHasShadow(true)
  }
  return true
}

function sendViewMode(mode) {
  currentViewMode = mode === "character" ? "character" : "chatWithCharacter"
  mainWindow?.show()
  mainWindow?.webContents.send("mon-agent-view-mode", currentViewMode)
  updateTray()
}

function resolveWebUrl(page) {
  const webPort = Number(getAgentConfig("server", "WEB_PORT", String(DEFAULT_WEB_PORT)))
  const devUrl = `http://127.0.0.1:${Number.isFinite(webPort) ? webPort : DEFAULT_WEB_PORT}`
  if (!page) return devUrl
  const url = new URL(devUrl)
  url.searchParams.set("page", page)
  return url.toString()
}

function loadWebApp(targetWindow, page) {
  if (app.isPackaged) {
    const options = page ? { query: { page } } : undefined
    targetWindow.loadFile(path.join(agentRoot, "frontend", "web", "dist", "index.html"), options)
  } else {
    targetWindow.loadURL(resolveWebUrl(page))
  }
}

function createWindow() {
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
  mainWindow.on("move", savePetWindowPosition)
  loadWebApp(mainWindow)
}

async function createPetWindow() {
  if (petWindow && !petWindow.isDestroyed()) {
    if (petWindow.isMinimized()) petWindow.restore()
    petWindow.show()
    petWindow.focus()
    applyPetWindowSettings()
    return
  }

  const preload = path.join(__dirname, "preload.cjs")
  const icon = path.join(__dirname, "..", "assets", "icon.ico")
  const bounds = petWindowBounds() ?? { width: 280, height: 640 }
  petWindow = new BrowserWindow({
    title: `${APP_WINDOW_TITLE} 桌宠`,
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 1,
    minHeight: 1,
    show: false,
    frame: false,
    titleBarStyle: "hidden",
    autoHideMenuBar: true,
    transparent: true,
    backgroundColor: "#00000000",
    icon: fs.existsSync(icon) ? icon : undefined,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
    },
  })

  petWindow.once("ready-to-show", () => {
    petWindow?.show()
    applyPetWindowSettings()
  })
  petWindow.on("closed", () => {
    petWindow = null
    updateTray()
  })
  petWindow.on("move", savePetWindowPosition)
  loadWebApp(petWindow, "pet")
  updateTray()
}

async function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore()
    settingsWindow.show()
    settingsWindow.focus()
    return
  }

  const preload = path.join(__dirname, "preload.cjs")
  const icon = path.join(__dirname, "..", "assets", "icon.ico")
  settingsWindow = new BrowserWindow({
    title: "MonAgent 设置",
    width: 880,
    height: 640,
    minWidth: 720,
    minHeight: 520,
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

  settingsWindow.once("ready-to-show", () => {
    settingsWindow?.show()
  })
  settingsWindow.on("closed", () => {
    settingsWindow = null
  })
  loadWebApp(settingsWindow, "settings")
}

function hasQuitFlag() {
  return fs.existsSync(quitFlag)
}

function writeQuitFlag() {
  try {
    fs.mkdirSync(path.dirname(quitFlag), { recursive: true })
    fs.writeFileSync(quitFlag, String(Date.now()), "utf8")
  } catch (error) {
    console.warn("[MonAgent][Desktop] 写入退出标记失败", error)
  }
}

function watchQuitFlag() {
  setInterval(() => {
    if (!hasQuitFlag()) return
    isQuitting = true
    app.quit()
  }, 500).unref?.()
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
  const petVisible = Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible())
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示主窗口", click: () => mainWindow?.show() },
      { label: "隐藏主窗口", click: () => mainWindow?.hide() },
      { type: "separator" },
      {
        label: petVisible ? "隐藏桌宠" : "显示桌宠",
        click: () => {
          if (petVisible) {
            petWindow?.hide()
            updateTray()
          } else {
            void createPetWindow()
          }
        },
      },
      {
        label: "设置",
        click: () => {
          void createSettingsWindow()
        },
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          isQuitting = true
          writeQuitFlag()
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
      return setWindowSize(args.request ?? {}, BrowserWindow.fromWebContents(_event.sender) ?? mainWindow)
    case "set_window_appearance":
      return setWindowAppearance(args.mode, BrowserWindow.fromWebContents(_event.sender) ?? mainWindow)
    case "open_pet_window":
      await createPetWindow()
      return true
    case "set_view_mode_state":
      currentViewMode = args.mode === "character" ? "character" : "chatWithCharacter"
      updateTray()
      applyPetWindowSettings()
      return true
    case "get_pet_settings":
      return petSettings
    case "apply_pet_settings":
      return updatePetSettings(args.settings ?? {})
    case "start_window_drag":
      return true
    case "close_current_window": {
      const targetWindow = BrowserWindow.fromWebContents(_event.sender)
      targetWindow?.close()
      return true
    }
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
    watchQuitFlag()
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
