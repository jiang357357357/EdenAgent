import { Lock, Menu, MessageSquare, NotebookPen, Unlock } from "lucide-react"
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
  initial: { opacity: 0, x: -18, filter: "blur(3px)" },
  animate: { opacity: 1, x: 0, filter: "blur(0px)" },
  exit: { opacity: 0, x: -26, filter: "blur(3px)" },
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
  onOpenSelfAwake: () => void
  onOpenMemo: () => void
}

export function ChatPage({
  sessions,
  activeSessionId,
  activeSession,
  sidebarOpen,
  setSidebarOpen,
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
  onOpenSelfAwake,
  onOpenMemo,
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
      className="fixed inset-0 z-10 flex h-[100vh] w-[100vw] overflow-hidden bg-bg font-sans text-text"
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
        currentUser={currentUser}
        onSelfAwake={onOpenSelfAwake}
        onLogout={onLogout}
      />

      <main className="relative flex h-[100vh] w-[66vw] flex-none flex-col">
        <header className="sticky top-0 z-10 flex h-[12.5vh] items-center justify-between border-b border-border bg-bg/80 px-[3.2vw] backdrop-blur-md">
          <div className="flex min-w-0 items-center gap-[1.6vw] font-serif text-[3.1vh] text-text">
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-[1vh] p-[1.4vh] text-text-muted transition-colors hover:bg-card hover:text-text"
              aria-label="打开会话抽屉"
            >
              <Menu className="h-[3.2vh] w-[3.2vh]" />
            </button>
            <MessageSquare className="h-[2.7vh] w-[2.7vh] text-accent" />
            <span className="truncate">{activeSession?.title || "新会话"}</span>
          </div>
          <div className="flex items-center gap-[1vw]">
            <button
              type="button"
              onClick={onOpenMemo}
              className="flex items-center gap-[0.6vw] rounded-full border border-border bg-card px-[1.6vw] py-[1.35vh] text-[1.75vh] tracking-[0.12em] text-text-muted shadow-sm transition-colors hover:border-accent/40 hover:text-accent"
              title="打开备忘录"
              aria-label="打开备忘录"
            >
              <NotebookPen className="h-[2.45vh] w-[2.45vh]" />
              <span className="hidden sm:inline">备忘录</span>
            </button>
            <button
              type="button"
              onClick={toggleAutoScroll}
              className={cn(
                "flex items-center gap-[0.6vw] rounded-full border px-[1.6vw] py-[1.35vh] text-[1.75vh] tracking-[0.12em] shadow-sm transition-colors",
                autoScrollEnabled
                  ? "border-accent/25 bg-card text-accent hover:border-accent/45"
                  : "border-border bg-card text-text-muted hover:border-accent/35 hover:text-accent",
              )}
              title={autoScrollEnabled ? "自动滚动已开启，点击关闭" : "自动滚动已关闭，点击恢复到底部"}
              aria-label={autoScrollEnabled ? "关闭自动滚动" : "开启自动滚动"}
            >
              {autoScrollEnabled ? <Lock className="h-[2.45vh] w-[2.45vh]" /> : <Unlock className="h-[2.45vh] w-[2.45vh]" />}
              <span className="hidden sm:inline">{autoScrollEnabled ? "自动滚动" : "已关闭"}</span>
            </button>
          </div>
        </header>

        <div
          key={activeSessionId || "no-session"}
          ref={messagesScrollRef}
          className="flex-1 overflow-y-auto scroll-smooth"
        >
          <div className="mx-auto w-[calc(100%_-_5vw)] max-w-[52vw] px-[1vw]">
            {connectionError ? (
              <div className="flex h-[61vh] flex-col items-center justify-center text-center">
                <div className="mb-[2vh] rounded-full border border-border bg-card px-[2vw] py-[1.2vh] text-[1.8vh] uppercase tracking-[0.15em] text-accent shadow-sm">
                  后端离线
                </div>
                <p className="max-w-[46vw] text-[2.2vh] leading-relaxed text-text-muted">
                  无法连接 MonAgent 服务：{connectionError}
                </p>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex h-[61vh] flex-col items-center justify-center text-center text-text-muted">
                <div className="mb-[4vh] flex h-[13vh] w-[13vh] items-center justify-center overflow-hidden rounded-[2.6vh] border border-border bg-card text-accent shadow-sm">
                  {assistantAvatarUrl ? (
                    <img
                      src={assistantAvatarUrl}
                      alt={assistantName}
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <span className="font-serif text-[5.2vh]">{assistantInitial}</span>
                  )}
                </div>
                <h2 className="mb-[1.4vh] font-serif text-[4.4vh] text-text">想聊点什么？</h2>
                <p className="max-w-[48vw] text-[2.35vh] leading-[1.55] text-text-muted">
                  可以问我项目结构、代码问题，也可以让我查看截图、分析页面或协助构建工具。
                </p>
              </div>
            ) : (
              <div className="min-h-full py-[4vh]">
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
                  <div className="flex w-full gap-[1.7vw] px-[1vw] py-[4vh] opacity-70 md:px-0">
                    <div className="flex h-[5.9vh] w-[5.9vh] flex-shrink-0 items-center justify-center overflow-hidden rounded-[1vh] border border-accent bg-card text-[2vh] text-accent">
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
                      <span className="animate-pulse font-serif text-[2.2vh] text-text-muted">
                        {assistant?.name || assistant?.character?.name || "助手"}正在思考...
                      </span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} className="h-[7vh]" />
              </div>
            )}
          </div>
        </div>

        {(activePendingPermissions.length > 0 || activePendingQuestions.length > 0) && (
          <div className="pointer-events-none fixed bottom-[15vh] left-[3vw] z-30 w-[min(58vw,760px)] max-h-[44vh] overflow-y-auto">
            <div className="pointer-events-auto grid gap-[2vh]">
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
          </div>
        )}

        <div className="px-[3vw]">
          <div className="mx-auto w-[calc(100%_-_5vw)] max-w-[52vw]">
            <ChatInput onSend={onSendMessage} disabled={isThinking} assistantName={assistantName} />
          </div>
        </div>
      </main>

      <CharacterPanel assistant={assistant} assistantError={assistantError} />
    </motion.div>
  )
}
