import { useState, useRef, useEffect } from "react"
import { X } from "lucide-react"
import { AnimatePresence, LayoutGroup, motion } from "motion/react"
import { ChatPage } from "./pages/chat"
import { CharacterPage } from "./pages/character"
import { LoginPage } from "./pages/login"
import { MemoPage } from "./pages/memo"
import { SelfAwakePage } from "./pages/self-awake"
import { SettingsPage } from "./pages/settings"
import { useSessionRuntime } from "./hooks/useSessionRuntime"
import {
  clearAuth,
  fetchDefaultAssistant,
  getAuthMode,
  getErrorMessage,
  getStoredToken,
  getStoredTokenExpiresAt,
  getStoredUser,
  getDevAccount,
  isAuthExpiredError,
  isStoredTokenExpired,
  loginWithCore,
  logoutWithCore,
  verifyTokenWithCore,
  type CoreAssistant,
  type DevAccount,
} from "./lib/auth"
import type { MessageData, PromptAttachment } from "./types"
import {
  listenDesktopOpenSettings,
  openDesktopPetWindow,
  resizeDesktopWindow,
  setDesktopWindowAppearance,
  startDesktopWindowDrag,
} from "./lib/desktop-window"
import { getToolStatus, type ToolStatus } from "./lib/mon_agent_api"

const screenTransition = {
  duration: 0.28,
  ease: [0.16, 1, 0.3, 1],
} as const

type AppPage = "chat" | "selfAwake" | "memo" | "settings" | "pet"

function initialPageFromLocation(): AppPage {
  const page = new URLSearchParams(window.location.search).get("page")
  if (page === "settings" || page === "pet") return page
  return "chat"
}

function textLength(value?: string) {
  return value?.length ?? 0
}

function messageScrollSignature(message: MessageData) {
  const segmentSignature =
    message.segments
      ?.map((segment) => {
        if (segment.type === "text" || segment.type === "runtimeTrace" || segment.type === "thinking") {
          return `${segment.id}:${segment.type}:${segment.state ?? ""}:${segment.content.length}`
        }
        if (segment.type === "tool") {
          return `${segment.id}:tool:${segment.tool.status}:${textLength(segment.tool.output)}:${textLength(segment.tool.error)}`
        }
        if (segment.type === "meta") {
          return `${segment.id}:meta:${segment.part.type}:${textLength(segment.part.summary)}:${textLength(segment.part.detail)}`
        }
        return `${segment.id}:image:${segment.url}`
      })
      .join(",") ?? ""

  const toolSignature =
    message.toolCalls
      ?.map((tool) => `${tool.id}:${tool.status}:${textLength(tool.output)}:${textLength(tool.error)}`)
      .join(",") ?? ""
  const metaSignature =
    message.metaParts
      ?.map((part) => `${part.id}:${part.type}:${textLength(part.summary)}:${textLength(part.detail)}`)
      .join(",") ?? ""

  return [
    message.id,
    message.role,
    textLength(message.content),
    textLength(message.runtimeTrace),
    message.runtimeTraceState ?? "",
    textLength(message.thinking),
    message.thinkingState ?? "",
    message.images?.join(",") ?? "",
    message.isStreaming ? "streaming" : "done",
    segmentSignature,
    toolSignature,
    metaSignature,
  ].join("|")
}

export default function App() {
  const [authStatus, setAuthStatus] = useState<"checking" | "authenticated" | "unauthenticated">("checking")
  const [authError, setAuthError] = useState<string | undefined>()
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [currentUser, setCurrentUser] = useState(() => getStoredUser())
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const initialPage = initialPageFromLocation()
  const isSettingsWindow = initialPage === "settings"
  const isPetWindow = initialPage === "pet"
  const [activePage, setActivePage] = useState<AppPage>(() => initialPageFromLocation())
  const [modeContentVisible, setModeContentVisible] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyView, setHistoryView] = useState<"messages" | "sessions">("messages")
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | undefined>()
  const [defaultAssistant, setDefaultAssistant] = useState<CoreAssistant | null>(null)
  const [defaultAssistantError, setDefaultAssistantError] = useState<string | undefined>()
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)
  const [toolStatus, setToolStatus] = useState<ToolStatus | undefined>()
  const messagesScrollRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const authProbeInFlightRef = useRef(false)
  const modeResizeTimerRef = useRef<number | undefined>(undefined)
  const modeSwitchTokenRef = useRef(0)
  const {
    activeSession,
    activeSessionId,
    activeSessionError,
    connectionError,
    createSession: createRuntimeSession,
    dismissQuestion,
    isThinking,
    pendingPermissions,
    pendingQuestions,
    reset: resetSessionRuntime,
    respondPermission,
    answerQuestion,
    selectSession: selectRuntimeSession,
    sendMessage: sendRuntimeMessage,
    sessions,
  } = useSessionRuntime(authStatus === "authenticated")

  const reportAuthError = (stage: string, error: unknown, fallback: string) => {
    const message = getErrorMessage(error, fallback)
    console.error(`[Auth] ${stage} failed`, error)
    return message
  }

  function resetRuntimeState() {
    modeSwitchTokenRef.current += 1
    if (modeResizeTimerRef.current) {
      window.clearTimeout(modeResizeTimerRef.current)
      modeResizeTimerRef.current = undefined
    }
    setModeContentVisible(true)
    setSidebarOpen(false)
    resetSessionRuntime()
    setDefaultAssistant(null)
    setDefaultAssistantError(undefined)
    setActivePage("chat")
    setHistoryOpen(false)
    setHistoryView("messages")
    document.documentElement.classList.remove("character-transparent")
  }

  function returnToLogin(message?: string) {
    clearAuth()
    setCurrentUser(null)
    resetRuntimeState()
    setAuthError(message)
    setAuthStatus("unauthenticated")
  }

  async function verifyAuthStillValid(reason: string) {
    const token = getStoredToken()
    if (!token) {
      returnToLogin("登录已失效，请重新登录。")
      return false
    }

    if (isStoredTokenExpired(0)) {
      returnToLogin("登录已失效，请重新登录。")
      return false
    }

    if (authProbeInFlightRef.current) return true
    authProbeInFlightRef.current = true
    try {
      await verifyTokenWithCore(token)
      return true
    } catch (error) {
      if (isAuthExpiredError(error)) {
        returnToLogin("登录已失效，请重新登录。")
        return false
      }
      console.warn(`[Auth] token probe skipped after ${reason}`, error)
      return true
    } finally {
      authProbeInFlightRef.current = false
    }
  }

  // Auto-scroll to bottom when messages change
  const activeMessages = activeSession?.messages ?? []
  const messageScrollKey = activeMessages.map(messageScrollSignature).join("\n")
  const assistantDisplayName = defaultAssistant?.name || defaultAssistant?.character?.name || "助手"
  const lastUserMessageIndex = activeMessages.reduce(
    (lastIndex, message, index) => (message.role === "user" ? index : lastIndex),
    -1,
  )
  const activeReplyMessage = activeMessages
    .slice(Math.max(lastUserMessageIndex + 1, 0))
    .reverse()
    .find((message) => message.role === "assistant")
  const dialogSegments = activeMessages.flatMap((message) => {
    const speaker = message.role === "user" ? "你" : assistantDisplayName
    const segments: Array<{
      speaker: string
      text?: string
      images?: string[]
      runtimeTrace?: string
      thinking?: string
      tool?: NonNullable<MessageData["toolCalls"]>[number]
    }> = []

    if (message.segments?.length) {
      for (const segment of message.segments) {
        if (segment.type === "text") {
          for (const text of segment.content
            .split(/\n{2,}/)
            .map((item) => item.trim())
            .filter(Boolean)) {
            segments.push({ speaker, text })
          }
        } else if (segment.type === "image") {
          segments.push({ speaker, images: [segment.url] })
        } else if (segment.type === "runtimeTrace") {
          segments.push({ speaker, runtimeTrace: segment.content })
        } else if (segment.type === "thinking") {
          segments.push({ speaker, thinking: segment.content })
        } else if (segment.type === "tool") {
          segments.push({ speaker, tool: segment.tool })
        }
      }
      return segments
    }

    if (message.images?.length) {
      segments.push({
        speaker,
        images: message.images,
      })
    }

    if (message.runtimeTrace) {
      segments.push({
        speaker,
        runtimeTrace: message.runtimeTrace,
      })
    }

    if (message.thinking) {
      segments.push({
        speaker,
        thinking: message.thinking,
      })
    }

    if (message.toolCalls?.length) {
      for (const tool of message.toolCalls) {
        segments.push({
          speaker,
          tool,
        })
      }
    }

    if (message.content) {
      for (const text of message.content
        .split(/\n{2,}/)
        .map((item) => item.trim())
        .filter(Boolean)) {
        segments.push({ speaker, text })
      }
    }

    return segments
  })
  const activePendingPermissions = pendingPermissions.filter(
    (request) => !activeSessionId || request.sessionID === activeSessionId,
  )
  const activePendingQuestions = pendingQuestions.filter(
    (request) => !activeSessionId || request.sessionID === activeSessionId,
  )

  useEffect(() => {
    let cancelled = false

    async function bootstrapAuth() {
      const mode = getAuthMode()
      console.log("[bootstrapAuth] authMode:", mode)

      if (mode === "production") {
        console.log("[bootstrapAuth] production mode, clearing auth")
        clearAuth()
        setCurrentUser(null)
        setAuthError(undefined)
        setAuthStatus("unauthenticated")
        return
      }

      const token = getStoredToken()
      console.log("[bootstrapAuth] stored token:", token ? "exists" : "none")

      if (token) {
        try {
          console.log("[bootstrapAuth] verifying token...")
          const response = await verifyTokenWithCore(token)
          if (cancelled) return
          console.log("[bootstrapAuth] token valid, user:", response.user.username)
          setCurrentUser(response.user)
          setAuthError(undefined)
          setAuthStatus("authenticated")
          return
        } catch (error) {
          console.log("[bootstrapAuth] token invalid:", error)
          if (cancelled) return
          clearAuth()
          setCurrentUser(null)
          if (cancelled) return
          setAuthError(reportAuthError("verify-token", error, "登录已失效。"))
        }
      }

      console.log("[bootstrapAuth] trying dev account login...")
      let devAccount: DevAccount | null = null
      try {
        devAccount = await getDevAccount()
        console.log("[bootstrapAuth] getDevAccount result:", devAccount)
      } catch (error) {
        console.error("[bootstrapAuth] getDevAccount error:", error)
      }

      if (devAccount && !cancelled) {
        try {
          console.log("[bootstrapAuth] logging in with dev account:", devAccount.username)
          const response = await loginWithCore(devAccount.username, devAccount.password)
          if (cancelled) return
          console.log("[bootstrapAuth] dev login success, user:", response.user.username)
          setCurrentUser(response.user)
          setAuthError(undefined)
          setAuthStatus("authenticated")
          return
        } catch (error) {
          console.error("[bootstrapAuth] dev login failed:", error)
        }
      }

      console.log("[bootstrapAuth] no dev account, showing LoginPage")
      if (!cancelled) setAuthStatus("unauthenticated")
    }

    void bootstrapAuth()
    return () => {
      cancelled = true
    }
  }, [])

  function scrollMessagesToBottom(behavior: ScrollBehavior = "smooth") {
    messagesEndRef.current?.scrollIntoView({ behavior, block: "end" })
  }

  function handleAutoScrollChange(enabled: boolean) {
    setAutoScrollEnabled(enabled)
    if (enabled) {
      window.setTimeout(() => scrollMessagesToBottom("smooth"), 0)
    }
  }

  useEffect(() => {
    setAutoScrollEnabled(true)
  }, [activeSessionId])

  useEffect(() => {
    if (!autoScrollEnabled) return
    scrollMessagesToBottom("smooth")
  }, [messageScrollKey, autoScrollEnabled])

  useEffect(() => {
    if (isSettingsWindow || isPetWindow) return
    void resizeDesktopWindow(authStatus === "authenticated" ? "chatWithCharacter" : "login")
    if (authStatus !== "authenticated") return
    void setDesktopWindowAppearance("chatWithCharacter")
  }, [authStatus, isPetWindow, isSettingsWindow])

  useEffect(() => {
    if (authStatus !== "authenticated") {
      setDefaultAssistant(null)
      setDefaultAssistantError(undefined)
      return
    }

    const token = getStoredToken()
    if (!token) {
      setDefaultAssistant(null)
      setDefaultAssistantError("未找到登录 token。")
      return
    }

    let cancelled = false

    async function loadDefaultAssistant() {
      try {
        const assistant = await fetchDefaultAssistant(token)
        if (cancelled) return
        setDefaultAssistant(assistant)
        setDefaultAssistantError(undefined)
      } catch (error) {
        if (cancelled) return
        if (isAuthExpiredError(error)) {
          returnToLogin("登录已失效，请重新登录。")
          return
        }
        const message = getErrorMessage(error, "未找到默认助手。")
        console.warn("[Assistant] load default assistant failed", error)
        setDefaultAssistant(null)
        setDefaultAssistantError(message)
      }
    }

    void loadDefaultAssistant()
    return () => {
      cancelled = true
    }
  }, [authStatus, currentUser?.id])

  useEffect(() => {
    if (authStatus !== "authenticated") return

    if (isStoredTokenExpired(0)) {
      returnToLogin("登录已失效，请重新登录。")
      return
    }

    const expiresAt = getStoredTokenExpiresAt()
    const delay = expiresAt
      ? Math.max(0, Math.min(expiresAt - Date.now() + 250, 2_147_483_647))
      : 60_000

    const timeout = window.setTimeout(() => {
      void verifyAuthStillValid("token-expiry")
    }, delay)
    const interval = window.setInterval(() => {
      if (isStoredTokenExpired(0)) {
        void verifyAuthStillValid("token-interval")
      }
    }, 60_000)

    return () => {
      window.clearTimeout(timeout)
      window.clearInterval(interval)
    }
  }, [authStatus, currentUser?.id])

  useEffect(() => {
    if (authStatus !== "authenticated") {
      setToolStatus(undefined)
      return
    }

    let cancelled = false
    const load = async () => {
      try {
        const status = await getToolStatus()
        if (!cancelled) setToolStatus(status)
      } catch (error) {
        if (!cancelled) {
          setToolStatus({
            search: {
              status: "offline",
              provider: "duckduckgo",
              mode: "embedded",
              label: "DuckDuckGo",
              message: error instanceof Error ? error.message : String(error),
            },
            tools: {
              search: "web_search",
              fetch: "web_fetch",
            },
          })
        }
      }
    }

    void load()
    const timer = window.setInterval(() => void load(), 30000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [authStatus])

  useEffect(() => {
    if (isSettingsWindow || isPetWindow) return
    if (authStatus !== "authenticated") return
    let cleanupOpenSettings: (() => void) | undefined
    let disposed = false

    void listenDesktopOpenSettings(() => {
      setActivePage("settings")
      setSidebarOpen(false)
    }).then((dispose) => {
      if (disposed) {
        dispose?.()
        return
      }
      cleanupOpenSettings = dispose
    })

    return () => {
      disposed = true
      cleanupOpenSettings?.()
    }
  }, [authStatus, isPetWindow, isSettingsWindow])

  useEffect(() => {
    return () => {
      if (modeResizeTimerRef.current) {
        window.clearTimeout(modeResizeTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (authStatus !== "authenticated") return
    const text = `${connectionError ?? ""} ${activeSessionError ?? ""}`
    if (/authentication_expired|not_authenticated|core_authentication_expired/i.test(text)) {
      returnToLogin("登录已失效，请重新登录。")
      return
    }
    if (connectionError) {
      void verifyAuthStillValid("connection-error")
    }
  }, [activeSessionError, authStatus, connectionError])

  const handleLogin = async (username: string, password: string) => {
    if (!username || !password) {
      setAuthError("请输入用户名和密码。")
      return
    }

    setIsAuthenticating(true)
    setAuthError(undefined)

    try {
      const response = await loginWithCore(username, password)
      setCurrentUser(response.user)
      setAuthStatus("authenticated")
      resetSessionRuntime()
      setDefaultAssistant(null)
      setDefaultAssistantError(undefined)
    } catch (error) {
      setAuthStatus("unauthenticated")
      setAuthError(reportAuthError("login", error, "登录失败"))
    } finally {
      setIsAuthenticating(false)
    }
  }

  const handleLogout = async () => {
    const token = getStoredToken()
    try {
      await logoutWithCore(token)
    } catch (error) {
      console.warn("[Auth] logout request failed after local logout", error)
      clearAuth()
    } finally {
      setCurrentUser(null)
      resetRuntimeState()
      setAuthError(undefined)
      setAuthStatus("unauthenticated")
    }
  }

  const handleSendMessage = async (content: string, attachments: PromptAttachment[]) => {
    try {
      await sendRuntimeMessage(content, attachments)
    } catch (error) {
      console.error("[Runtime] send message failed", error)
    }
  }

  const handleNewSession = async () => {
    try {
      await createRuntimeSession()
      setSidebarOpen(false)
    } catch (error) {
      console.error("[Runtime] create session failed", error)
    }
  }

  const handlePermissionReply = async (requestID: string, reply: "once" | "always" | "reject", message?: string) => {
    await respondPermission(requestID, reply, message)
  }

  const handleQuestionReply = async (requestID: string, answers: string[][]) => {
    await answerQuestion(requestID, answers)
  }

  const handleQuestionReject = async (requestID: string) => {
    await dismissQuestion(requestID)
  }

  async function handleOpenPetWindow() {
    const opened = await openDesktopPetWindow()
    if (!opened) {
      setActivePage("pet")
    }
  }

  if (authStatus === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-text">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
          <p className="text-sm text-text-muted">正在准备登录...</p>
        </div>
      </div>
    )
  }

  if (authStatus !== "authenticated") {
    return <LoginPage onLogin={handleLogin} isSubmitting={isAuthenticating} error={authError} />
  }

  return (
    <>
      <motion.div
        animate={{
          opacity: modeContentVisible ? 1 : 0,
          filter: modeContentVisible ? "blur(0px)" : "blur(6px)",
        }}
        transition={{ duration: modeContentVisible ? 0.22 : 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="fixed inset-0"
      >
        <LayoutGroup id="mon-agent-mode-switch">
          <AnimatePresence mode="wait" initial={false}>
            {isPetWindow || activePage === "pet" ? (
              <CharacterPage
                isThinking={isThinking}
                activeSession={activeSession}
                activeReplyMessage={activeReplyMessage}
                activePendingPermissions={activePendingPermissions}
                activePendingQuestions={activePendingQuestions}
                historyOpen={historyOpen}
                historyView={historyView}
                sessions={sessions}
                activeSessionId={activeSessionId}
                dialogSegments={dialogSegments}
                onSetHistoryOpen={setHistoryOpen}
                onSetHistoryView={setHistoryView}
                onSelectSession={selectRuntimeSession}
                onSendMessage={handleSendMessage}
                onPermissionReply={handlePermissionReply}
                onQuestionReply={handleQuestionReply}
                onQuestionReject={handleQuestionReject}
                onStartWindowDrag={startDesktopWindowDrag}
                assistant={defaultAssistant}
                assistantError={defaultAssistantError}
                onPreviewImage={(src, alt) => setPreviewImage({ src, alt: alt ?? "图片预览" })}
              />
            ) : activePage === "selfAwake" ? (
              <SelfAwakePage
                currentUser={currentUser}
                assistant={defaultAssistant}
                toolStatus={toolStatus}
                onBack={() => setActivePage("chat")}
              />
            ) : activePage === "memo" ? (
              <MemoPage onBack={() => setActivePage("chat")} />
            ) : activePage === "settings" ? (
              <SettingsPage
                assistant={defaultAssistant}
                onBack={isSettingsWindow ? undefined : () => setActivePage("chat")}
              />
            ) : (
              <ChatPage
                sessions={sessions}
                activeSessionId={activeSessionId}
                activeSession={activeSession}
                sidebarOpen={sidebarOpen}
                setSidebarOpen={setSidebarOpen}
                currentUser={currentUser}
                assistant={defaultAssistant}
                assistantError={defaultAssistantError}
                isThinking={isThinking}
                connectionError={connectionError}
                activePendingPermissions={activePendingPermissions}
                activePendingQuestions={activePendingQuestions}
                messagesScrollRef={messagesScrollRef}
                messagesEndRef={messagesEndRef}
                autoScrollEnabled={autoScrollEnabled}
                onAutoScrollChange={handleAutoScrollChange}
                onSelectSession={selectRuntimeSession}
                onNewSession={handleNewSession}
                onSendMessage={handleSendMessage}
                onPermissionReply={handlePermissionReply}
                onQuestionReply={handleQuestionReply}
                onQuestionReject={handleQuestionReject}
                onPreviewImage={(src, alt) => setPreviewImage({ src, alt: alt ?? "图片预览" })}
                onLogout={handleLogout}
                onOpenSelfAwake={() => {
                  setSidebarOpen(false)
                  setActivePage("selfAwake")
                }}
                onOpenMemo={() => {
                  setSidebarOpen(false)
                  setActivePage("memo")
                }}
              />
            )}
          </AnimatePresence>
        </LayoutGroup>
      </motion.div>
      <AnimatePresence>
        {previewImage && (
          <motion.div
            key="image-preview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={screenTransition}
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/86 p-[4vw] backdrop-blur-lg"
            onClick={() => setPreviewImage(undefined)}
          >
            <button
              onClick={() => setPreviewImage(undefined)}
              className="absolute right-4 top-4 rounded-full border border-white/15 bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
              aria-label="关闭图片预览"
            >
              <X className="h-5 w-5" />
            </button>
            <motion.img
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={screenTransition}
              src={previewImage.src}
              alt={previewImage.alt}
              className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
              onClick={(event) => event.stopPropagation()}
              draggable={false}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
