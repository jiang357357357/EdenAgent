import { ArrowLeft, MessageSquare, X } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { ChatInput } from "../../components/ChatInput"
import { PermissionRequestCard } from "../../components/PermissionRequestCard"
import { QuestionRequestCard } from "../../components/QuestionRequestCard"
import { resolveCoreAssetUrl, type CoreAssistant } from "../../lib/auth"
import { resolveMonAgentUrl } from "../../lib/mon_agent_api"
import { cn } from "../../lib/utils"
import type { MessageData, PendingPermission, PendingQuestion, PromptAttachment, Session, ToolCall } from "../../types"

const screenTransition = {
  duration: 0.28,
  ease: [0.16, 1, 0.3, 1],
} as const

const characterScreenMotion = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
}

function toolStatusLabel(status?: ToolCall["status"]) {
  if (status === "running") return "运行中"
  if (status === "success") return "完成"
  if (status === "error") return "失败"
  return ""
}

interface DialogSegment {
  speaker: string
  text?: string
  images?: string[]
  runtimeTrace?: string
  thinking?: string
  tool?: ToolCall
}

interface CharacterPageProps {
  isThinking: boolean
  activeSession?: Session
  activeReplyMessage?: MessageData
  activePendingPermissions: PendingPermission[]
  activePendingQuestions: PendingQuestion[]
  historyOpen: boolean
  historyView: "messages" | "sessions"
  sessions: Session[]
  activeSessionId: string
  dialogSegments: DialogSegment[]
  onSetHistoryOpen: (open: boolean) => void
  onSetHistoryView: (view: "messages" | "sessions") => void
  onSelectSession: (id: string) => void
  onSendMessage: (content: string, attachments: PromptAttachment[]) => Promise<void>
  onPermissionReply: (requestID: string, reply: "once" | "always" | "reject", message?: string) => Promise<void>
  onQuestionReply: (requestID: string, answers: string[][]) => Promise<void>
  onQuestionReject: (requestID: string) => Promise<void>
  onStartWindowDrag: () => Promise<void> | void
  assistant?: CoreAssistant | null
  assistantError?: string
  onPreviewImage: (src: string, alt?: string) => void
  onSwitchMode: () => void
}

export function CharacterPage({
  isThinking,
  activeSession,
  activeReplyMessage,
  activePendingPermissions,
  activePendingQuestions,
  historyOpen,
  historyView,
  sessions,
  activeSessionId,
  dialogSegments,
  onSetHistoryOpen,
  onSetHistoryView,
  onSelectSession,
  onSendMessage,
  onPermissionReply,
  onQuestionReply,
  onQuestionReject,
  onStartWindowDrag,
  assistant,
  assistantError,
  onPreviewImage,
  onSwitchMode,
}: CharacterPageProps) {
  const character = assistant?.character
  const displayName = assistant?.name || character?.name || "默认助手"
  const characterImage = resolveCoreAssetUrl(character?.default_standing_image_url || character?.avatar_url)

  return (
    <motion.div
      key="character"
      {...characterScreenMotion}
      transition={screenTransition}
      className="h-[100vh] w-[100vw] !bg-transparent text-text font-sans overflow-hidden"
    >
      <main className="relative mx-auto h-[100vh] w-[100vw] overflow-hidden !bg-transparent">
        <button
          type="button"
          onClick={onSwitchMode}
          className="fixed right-[3vw] top-[2vh] z-30 flex items-center gap-2 rounded-full border border-orange-300/35 bg-white/85 px-3 py-2 text-[11px] font-medium tracking-[0.08em] text-stone-700 shadow-sm backdrop-blur-md transition-colors hover:border-orange-400/55 hover:text-orange-600"
          title="切换到聊天模式"
          aria-label="切换到聊天模式"
        >
          <MessageSquare className="h-4 w-4" />
          <span>聊天模式</span>
        </button>
        <section className="pointer-events-none absolute inset-0 flex items-end justify-center text-center">
          <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 1 }}
            transition={{ ...screenTransition, delay: 0.08 }}
            className="relative h-[100vh] w-[100vw] overflow-hidden !bg-transparent shadow-none"
          >
            {characterImage ? (
              <img
                src={characterImage}
                alt={displayName}
                className="absolute bottom-0 left-1/2 h-[100vh] w-auto max-w-none -translate-x-1/2 object-contain object-bottom shadow-none drop-shadow-none"
                draggable={false}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center px-[8vw]">
                <div className="rounded-3xl border border-white/20 bg-white/80 px-[6vw] py-[4vh] text-center text-stone-700 shadow-sm backdrop-blur">
                  <div className="font-serif text-[2.4vh] text-stone-900">
                    {assistant ? "未配置立绘" : "未绑定默认助手"}
                  </div>
                  <p className="mt-[1.2vh] text-[1.5vh] leading-relaxed text-stone-500">
                    {assistantError ||
                      (assistant ? "请在角色编辑里添加待机动作图片。" : "请在 Core 助手管理里设置默认助手。")}
                  </p>
                </div>
              </div>
            )}
          </motion.div>
        </section>

        <AnimatePresence>
          {historyOpen && (
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={screenTransition}
              className="fixed inset-0 z-40 flex flex-col bg-stone-950/90 text-stone-100 shadow-none backdrop-blur-xl"
            >
              <header className="flex items-center justify-between border-b border-white/10 px-4 py-4">
                <div className="flex min-w-0 items-center gap-2">
                  {historyView === "messages" ? (
                    <button
                      onClick={() => onSetHistoryView("sessions")}
                      className="rounded-lg p-2 text-stone-300 transition-colors hover:bg-white/10 hover:text-white"
                      aria-label="返回历史对话列表"
                      title="返回历史对话列表"
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </button>
                  ) : (
                    <div className="h-9 w-9" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate font-serif text-lg text-stone-50">
                      {historyView === "messages" ? activeSession?.title || "当前对话" : "历史对话"}
                    </div>
                    <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-stone-400">
                      {historyView === "messages" ? "当前历史" : "对话列表"}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => onSetHistoryOpen(false)}
                  className="rounded-lg p-2 text-stone-300 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="关闭历史"
                >
                  <X className="h-5 w-5" />
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
                {historyView === "sessions" ? (
                  <div className="mx-auto flex w-full max-w-[720px] flex-col gap-2 py-2">
                    {sessions.map((session) => (
                      <button
                        key={session.id}
                        onClick={() => {
                          onSelectSession(session.id)
                          onSetHistoryView("messages")
                        }}
                        className={cn(
                          "w-full rounded-xl border px-4 py-3 text-left transition-colors",
                          session.id === activeSessionId
                            ? "border-orange-400/50 bg-orange-500/15 text-stone-50"
                            : "border-white/10 bg-white/5 text-stone-300 hover:border-white/20 hover:bg-white/10 hover:text-white",
                        )}
                      >
                        <div className="truncate text-sm">{session.title}</div>
                        <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-stone-500">
                          {session.date}
                        </div>
                      </button>
                    ))}
                    {sessions.length === 0 && (
                      <div className="flex h-[50vh] items-center justify-center text-center text-sm text-stone-400">
                        还没有历史对话
                      </div>
                    )}
                  </div>
                ) : activeSession?.messages.length ? (
                  <div className="mx-auto flex w-full max-w-[720px] flex-col gap-3 py-2">
                    {activeSession.messages.map((message) => (
                      <article
                        key={message.id}
                        className={cn(
                          "min-w-0 rounded-2xl border px-4 py-3 [overflow-wrap:anywhere]",
                          message.role === "user"
                            ? "ml-8 border-orange-400/25 bg-orange-500/10"
                            : "mr-8 border-white/10 bg-white/7",
                        )}
                      >
                        <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-stone-400">
                          <span>{message.role === "user" ? "你" : displayName}</span>
                          <span className="text-stone-600">{message.timestamp}</span>
                        </div>
                        {message.images && message.images.length > 0 && (
                          <div className="mb-3 flex flex-wrap gap-2">
                            {message.images.map((image, index) => (
                              <img
                                key={`${message.id}-${index}`}
                                src={resolveMonAgentUrl(image)}
                                alt="历史图片"
                                onClick={() => onPreviewImage(resolveMonAgentUrl(image), "历史图片")}
                                className="max-h-28 max-w-full cursor-pointer rounded-lg border border-white/10 object-contain transition-opacity hover:opacity-85"
                              />
                            ))}
                          </div>
                        )}
                        {message.runtimeTrace && (
                          <details className="mb-3 rounded-xl border border-teal-300/15 bg-teal-400/10 px-3 py-2">
                            <summary className="cursor-pointer select-none text-[10px] uppercase tracking-[0.14em] text-teal-200/80">
                              运行过程
                            </summary>
                            <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-stone-300 [overflow-wrap:anywhere]">
                              {message.runtimeTrace}
                            </div>
                          </details>
                        )}
                        {message.thinking && (
                          <details className="mb-3 rounded-xl border border-sky-300/15 bg-sky-400/10 px-3 py-2">
                            <summary className="cursor-pointer select-none text-[10px] uppercase tracking-[0.14em] text-sky-200/80">
                              思考
                            </summary>
                            <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-stone-300 [overflow-wrap:anywhere]">
                              {message.thinking}
                            </div>
                          </details>
                        )}
                        {message.toolCalls && message.toolCalls.length > 0 && (
                          <div className="mb-3 grid gap-2">
                            {message.toolCalls.map((tool) => (
                              <details
                                key={tool.id}
                                className="rounded-xl border border-emerald-300/15 bg-emerald-400/10 px-3 py-2"
                              >
                                <summary className="cursor-pointer select-none text-[10px] uppercase tracking-[0.14em] text-emerald-200/80">
                                  工具：{tool.name}
                                  {tool.status ? ` · ${toolStatusLabel(tool.status)}` : ""}
                                  {tool.duration ? ` · ${tool.duration}ms` : ""}
                                </summary>
                                <div className="mt-2 grid gap-2">
                                  <div>
                                    <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-stone-500">
                                      输入
                                    </div>
                                    <pre className="whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-stone-300 [overflow-wrap:anywhere]">
                                      {tool.input}
                                    </pre>
                                  </div>
                                  {tool.output && (
                                    <div>
                                      <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-stone-500">
                                        输出
                                      </div>
                                      <pre className="whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-stone-300 [overflow-wrap:anywhere]">
                                        {tool.output}
                                      </pre>
                                    </div>
                                  )}
                                  {tool.error && (
                                    <div>
                                      <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-red-300/80">
                                        错误
                                      </div>
                                      <pre className="whitespace-pre-wrap rounded-lg border border-red-400/20 bg-red-950/30 p-2 text-xs text-red-200 [overflow-wrap:anywhere]">
                                        {tool.error}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              </details>
                            ))}
                          </div>
                        )}
                        {message.content && (
                          <div className="whitespace-pre-wrap text-sm leading-relaxed text-stone-100 [overflow-wrap:anywhere]">
                            {message.content}
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-center text-sm text-stone-400">
                    当前对话还没有历史消息
                  </div>
                )}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        <motion.div
          initial={{ opacity: 0, y: 28, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 1 }}
          transition={{ ...screenTransition, delay: 0.14 }}
          className="fixed inset-x-0 bottom-[2.5vh] z-20 px-[4vw]"
        >
          <div className="mx-auto w-full max-w-[min(88vw,760px)]">
            {(activePendingPermissions.length > 0 || activePendingQuestions.length > 0) && (
              <div className="mb-3 grid gap-3">
                {activePendingPermissions.map((request) => (
                  <PermissionRequestCard
                    key={request.id}
                    request={request}
                    onReply={onPermissionReply}
                    tone="overlay"
                  />
                ))}
                {activePendingQuestions.map((request) => (
                  <QuestionRequestCard
                    key={request.id}
                    request={request}
                    onReply={onQuestionReply}
                    onReject={onQuestionReject}
                    tone="overlay"
                  />
                ))}
              </div>
            )}
            <ChatInput
              onSend={onSendMessage}
              disabled={isThinking}
              overlay
              onHistory={() => {
                onSetHistoryView("messages")
                onSetHistoryOpen(true)
              }}
              onStartWindowDrag={onStartWindowDrag}
              outputActive={isThinking}
              outputContent={activeReplyMessage?.content ?? ""}
              outputThinking={activeReplyMessage?.thinking}
              outputTools={activeReplyMessage?.toolCalls}
              dialogSegments={dialogSegments}
              assistantName={displayName}
              onPreviewImage={(src, alt) => onPreviewImage(src, alt ?? "图片预览")}
            />
          </div>
        </motion.div>
      </main>
    </motion.div>
  )
}
