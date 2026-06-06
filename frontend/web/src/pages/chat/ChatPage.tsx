import { Lock, Menu, MessageSquare, Unlock, User } from "lucide-react"
import { motion } from "motion/react"
import { CharacterPanel } from "../../components/CharacterPanel"
import { ChatInput } from "../../components/ChatInput"
import { MessageBubble } from "../../components/MessageBubble"
import { PermissionRequestCard } from "../../components/PermissionRequestCard"
import { QuestionRequestCard } from "../../components/QuestionRequestCard"
import { Sidebar } from "../../components/Sidebar"
import { resolveCoreAssetUrl, type AuthUser, type CoreAssistant } from "../../lib/auth"
import { cn } from "../../lib/utils"
import type { PendingPermission, PendingQuestion, PromptAttachment, Session } from "../../types"

const fullScreenMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
}

const screenTransition = {
  duration: 0.28,
  ease: [0.16, 1, 0.3, 1],
} as const

interface ChatPageProps {
  sessions: Session[]
  activeSessionId: string
  activeSession?: Session
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  theme: "light" | "dark"
  toggleTheme: () => void
  currentUser?: AuthUser | null
  assistant?: CoreAssistant | null
  assistantError?: string
  isThinking: boolean
  connectionError?: string
  activePendingPermissions: PendingPermission[]
  activePendingQuestions: PendingQuestion[]
  messagesScrollRef: React.RefObject<HTMLDivElement | null>
  messagesEndRef: React.RefObject<HTMLDivElement | null>
  autoScrollEnabled: boolean
  onAutoScrollChange: (enabled: boolean) => void
  onSelectSession: (id: string) => void
  onNewSession: () => void
  onSendMessage: (content: string, attachments: PromptAttachment[]) => Promise<void>
  onPermissionReply: (requestID: string, reply: "once" | "always" | "reject", message?: string) => Promise<void>
  onQuestionReply: (requestID: string, answers: string[][]) => Promise<void>
  onQuestionReject: (requestID: string) => Promise<void>
  onPreviewImage: (src: string, alt?: string) => void
  onLogout: () => Promise<void> | void
  onSwitchMode: () => void
}

export function ChatPage({
  sessions,
  activeSessionId,
  activeSession,
  sidebarOpen,
  setSidebarOpen,
  theme,
  toggleTheme,
  currentUser,
  assistant,
  assistantError,
  isThinking,
  connectionError,
  activePendingPermissions,
  activePendingQuestions,
  messagesScrollRef,
  messagesEndRef,
  autoScrollEnabled,
  onAutoScrollChange,
  onSelectSession,
  onNewSession,
  onSendMessage,
  onPermissionReply,
  onQuestionReply,
  onQuestionReject,
  onPreviewImage,
  onLogout,
  onSwitchMode,
}: ChatPageProps) {
  const assistantName = assistant?.name || assistant?.character?.name || "助手"
  const assistantInitial = assistantName.trim().slice(0, 1) || "助"
  const assistantAvatarUrl = resolveCoreAssetUrl(assistant?.character?.avatar_url)
  const userAvatarUrl = resolveCoreAssetUrl(currentUser?.avatar_url)
  const messages = activeSession?.messages ?? []
  const hasStreamingAssistantMessage = messages.some(
    (message) => message.role === "assistant" && Boolean(message.isStreaming),
  )
  const toggleAutoScroll = () => {
    onAutoScrollChange(!autoScrollEnabled)
  }

  return (
    <motion.div
      key="chat-with-character"
      {...fullScreenMotion}
      transition={screenTransition}
      className="flex h-[100vh] w-[100vw] bg-bg text-text font-sans overflow-hidden"
    >
      <Sidebar
        sessions={sessions}
        activeId={activeSessionId}
        onSelect={(id) => {
          onSelectSession(id)
          setSidebarOpen(false)
        }}
        onNew={onNewSession}
        isOpen={sidebarOpen}
        setIsOpen={setSidebarOpen}
        theme={theme}
        toggleTheme={toggleTheme}
        currentUser={currentUser}
        onLogout={onLogout}
      />

      <main className="flex h-[100vh] min-w-0 flex-1 flex-col relative">
        <header className="flex items-center justify-between px-[2vw] py-[2vh] border-b border-border bg-bg/80 backdrop-blur-md z-10 sticky top-0">
          <div className="min-w-0 font-serif text-lg text-text flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="mr-1 rounded-md p-2 text-text-muted transition-colors hover:bg-card hover:text-text"
              aria-label="打开会话抽屉"
            >
              <Menu className="h-5 w-5" />
            </button>
            <MessageSquare className="w-4 h-4 text-accent" />
            <span className="truncate">{activeSession?.title || "新会话"}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleAutoScroll}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] tracking-[0.12em] shadow-sm transition-colors",
                autoScrollEnabled
                  ? "border-accent/25 bg-card text-accent hover:border-accent/45"
                  : "border-border bg-card text-text-muted hover:border-accent/35 hover:text-accent",
              )}
              title={autoScrollEnabled ? "自动滚动已开启，点击关闭" : "自动滚动已关闭，点击恢复到底部"}
              aria-label={autoScrollEnabled ? "关闭自动滚动" : "开启自动滚动"}
            >
              {autoScrollEnabled ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{autoScrollEnabled ? "自动滚动" : "已关闭"}</span>
            </button>
            <button
              type="button"
              onClick={onSwitchMode}
              className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1.5 text-[10px] tracking-[0.12em] text-text-muted shadow-sm transition-colors hover:border-accent/40 hover:text-accent"
              title="切换到桌宠模式"
              aria-label="切换到桌宠模式"
            >
              <User className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">桌宠模式</span>
            </button>
          </div>
        </header>

        <div
          key={activeSessionId || "no-session"}
          ref={messagesScrollRef}
          className="flex-1 overflow-y-auto scroll-smooth"
        >
          <div className="mx-auto w-full max-w-[min(62vw,720px)] px-[2vw]">
            {connectionError ? (
              <div className="h-full min-h-[50vh] flex flex-col items-center justify-center text-center">
                <div className="mb-3 rounded-full border border-border bg-card px-4 py-2 text-[10px] uppercase tracking-[0.15em] text-accent shadow-sm">
                  后端离线
                </div>
                <p className="max-w-md text-sm leading-relaxed text-text-muted">
                  无法连接 MonAgent 服务：{connectionError}
                </p>
              </div>
            ) : messages.length === 0 ? (
              <div className="h-full min-h-[50vh] flex flex-col items-center justify-center text-center text-text-muted">
                <div className="w-16 h-16 bg-card border border-border text-accent rounded-2xl flex items-center justify-center mb-6 shadow-sm overflow-hidden">
                  {assistantAvatarUrl ? (
                    <img
                      src={assistantAvatarUrl}
                      alt={assistantName}
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <span className="text-3xl font-serif">{assistantInitial}</span>
                  )}
                </div>
                <h2 className="text-2xl font-serif text-text mb-2">想聊点什么？</h2>
                <p className="text-text-muted max-w-sm text-[14px]">
                  可以问我项目结构、代码问题，也可以让我查看截图、分析页面或协助构建工具。
                </p>
              </div>
            ) : (
              <div className="py-6 min-h-full">
                {messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    userAvatarUrl={userAvatarUrl}
                    assistantName={assistantName}
                    assistantInitial={assistantInitial}
                    assistantAvatarUrl={assistantAvatarUrl}
                    onTextReveal={() => {
                      if (autoScrollEnabled) messagesEndRef.current?.scrollIntoView({ block: "end" })
                    }}
                    onPreviewImage={(src, alt) => onPreviewImage(src, alt ?? "图片预览")}
                  />
                ))}
                {isThinking && !hasStreamingAssistantMessage && (
                  <div className="flex gap-4 w-full px-4 py-6 md:px-0 opacity-70">
                    <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded border border-accent bg-card text-accent text-sm overflow-hidden">
                      {assistantAvatarUrl ? (
                        <img
                          src={assistantAvatarUrl}
                          alt={assistantName}
                          className="h-full w-full object-cover"
                          draggable={false}
                        />
                      ) : (
                        assistantInitial
                      )}
                    </div>
                    <div className="flex items-center">
                      <span className="text-sm font-serif text-text-muted animate-pulse">
                        {assistant?.name || assistant?.character?.name || "助手"}正在思考...
                      </span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} className="h-10" />
              </div>
            )}
          </div>
        </div>

        <div className="px-[2vw]">
          <div className="mx-auto w-full max-w-[min(62vw,720px)]">
            {(activePendingPermissions.length > 0 || activePendingQuestions.length > 0) && (
              <div className="mb-3 grid gap-3">
                {activePendingPermissions.map((request) => (
                  <PermissionRequestCard key={request.id} request={request} onReply={onPermissionReply} />
                ))}
                {activePendingQuestions.map((request) => (
                  <QuestionRequestCard
                    key={request.id}
                    request={request}
                    onReply={onQuestionReply}
                    onReject={onQuestionReject}
                  />
                ))}
              </div>
            )}
            <ChatInput onSend={onSendMessage} disabled={isThinking} assistantName={assistantName} />
          </div>
        </div>
      </main>

      <CharacterPanel assistant={assistant} assistantError={assistantError} />
    </motion.div>
  )
}
