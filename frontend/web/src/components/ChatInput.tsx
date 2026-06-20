import { useState, useRef, useEffect } from "react"
import { Send, Paperclip, X, History, Move, MessageSquare, Keyboard, ChevronLeft, FileText } from "lucide-react"
import { motion, AnimatePresence } from "motion/react"
import { resolveMonAgentUrl } from "../lib/mon_agent_api"
import { cn } from "../lib/utils"
import { MarkdownContent } from "./MarkdownContent"
import type { PromptAttachment, ToolCall } from "../types"

type DialogSegment = {
  speaker: string
  text?: string
  images?: string[]
  runtimeTrace?: string
  thinking?: string
  tool?: ToolCall
}

interface ChatInputProps {
  onSend: (text: string, attachments: PromptAttachment[]) => void
  disabled?: boolean
  overlay?: boolean
  onHistory?: () => void
  onStartWindowDrag?: () => void
  outputActive?: boolean
  outputContent?: string
  outputThinking?: string
  outputTools?: ToolCall[]
  dialogSegments?: DialogSegment[]
  assistantName?: string
  onPreviewImage?: (src: string, alt?: string) => void
  overlayCompact?: boolean
  hideOverlayActions?: boolean
  overlayOpacity?: number
  overlayHeight?: number
}

export function ChatInput({
  onSend,
  disabled,
  overlay = false,
  onHistory,
  onStartWindowDrag,
  outputActive = false,
  outputContent = "",
  outputThinking,
  outputTools = [],
  dialogSegments,
  assistantName = "助手",
  onPreviewImage,
  overlayCompact = false,
  hideOverlayActions = false,
  overlayOpacity = 76,
  overlayHeight,
}: ChatInputProps) {
  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<PromptAttachment[]>([])
  const [draggingFiles, setDraggingFiles] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragTimerRef = useRef<number | undefined>(undefined)
  const previousSegmentCountRef = useRef(0)
  const outputToolsKey = outputTools.map((tool) => `${tool.id}:${tool.status}:${tool.duration ?? ""}`).join("|")
  const fallbackOutputSegments: DialogSegment[] = [
    ...(outputThinking ? [{ speaker: assistantName, thinking: outputThinking }] : []),
    ...outputTools.map((tool) => ({
      speaker: assistantName,
      tool,
    })),
    ...outputContent
      .split(/\n{2,}/)
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => ({ speaker: assistantName, text })),
  ]
  const outputSegments = dialogSegments?.length ? dialogSegments : fallbackOutputSegments
  const [outputIndex, setOutputIndex] = useState(0)
  const [overlayMode, setOverlayMode] = useState<"input" | "dialog">("input")
  const hasDialog = overlay && (outputActive || outputSegments.length > 0)
  const isDialogMode = overlay && overlayMode === "dialog" && hasDialog
  const currentOutput = outputSegments[Math.min(outputIndex, Math.max(outputSegments.length - 1, 0))]

  useEffect(() => {
    const previousCount = previousSegmentCountRef.current
    const nextCount = outputSegments.length
    previousSegmentCountRef.current = nextCount

    setOutputIndex(Math.max(outputSegments.length - 1, 0))
    if (overlay && (outputActive || nextCount > previousCount)) setOverlayMode("dialog")
  }, [assistantName, outputActive, outputContent, outputThinking, outputToolsKey, outputSegments.length])

  useEffect(() => {
    if (textareaRef.current) {
      if (overlay) {
        textareaRef.current.style.height = ""
        return
      }
      textareaRef.current.style.height = "auto"
      const maxHeight = window.innerHeight * 0.24
      const contentHeight = textareaRef.current.scrollHeight
      textareaRef.current.style.height = `${Math.min(contentHeight, maxHeight)}px`
      textareaRef.current.style.overflowY = contentHeight > maxHeight + 1 ? "auto" : "hidden"
    }
  }, [input, overlay])

  const handleSend = () => {
    if ((!input.trim() && attachments.length === 0) || disabled) return
    onSend(input.trim(), attachments)
    setInput("")
    setAttachments([])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const addFileAttachment = (file: File) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      if (event.target?.result && typeof event.target.result === "string") {
        setAttachments((prev) => [
          ...prev,
          {
            url: event.target!.result as string,
            filename: file.name || `attachment-${prev.length + 1}`,
            mime: file.type || "application/octet-stream",
            size: file.size,
          },
        ])
      }
    }
    reader.readAsDataURL(file)
  }

  const addFileAttachments = (files: FileList | File[]) => {
    for (const file of Array.from(files)) addFileAttachment(file)
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (const item of items) {
      const file = item.getAsFile()
      if (file) addFileAttachment(file)
    }
  }

  const handleFilePick = () => {
    fileInputRef.current?.click()
  }

  const clearDragTimer = () => {
    if (dragTimerRef.current !== undefined) {
      window.clearTimeout(dragTimerRef.current)
      dragTimerRef.current = undefined
    }
  }

  const handleDragPointerDown = () => {
    if (!onStartWindowDrag) return
    clearDragTimer()
    dragTimerRef.current = window.setTimeout(() => {
      dragTimerRef.current = undefined
      onStartWindowDrag()
    }, 220)
  }

  const advanceOutput = () => {
    if (!isDialogMode) return
    setOutputIndex((index) => {
      if (index >= outputSegments.length - 1) {
        setOverlayMode("input")
        return index
      }
      return index + 1
    })
  }

  const previousOutput = () => {
    if (!isDialogMode) return
    setOutputIndex((index) => Math.max(index - 1, 0))
  }

  const toggleOverlayMode = () => {
    if (!hasDialog) return
    setOverlayMode((mode) => (mode === "dialog" ? "input" : "dialog"))
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    addFileAttachments(files)
    e.target.value = ""
  }

  const hasDraggedFiles = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes("Files")

  const handleDragOver = (event: React.DragEvent) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    setDraggingFiles(true)
  }

  const handleDragLeave = (event: React.DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDraggingFiles(false)
    }
  }

  const handleDrop = (event: React.DragEvent) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    setDraggingFiles(false)
    addFileAttachments(event.dataTransfer.files)
  }

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <div
      className={cn(
        "sticky bottom-0 z-10",
        overlay
          ? "bg-transparent p-0"
          : "bg-gradient-to-t from-bg via-bg/95 to-transparent pt-[1.2vh] pb-[2.8vh]",
      )}
      style={overlay ? { height: `${overlayHeight ?? (overlayCompact ? 20 : 40)}vh` } : undefined}
    >
      <AnimatePresence>
        {attachments.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="flex gap-2 mb-2 px-2 overflow-x-auto"
          >
            {attachments.map((attachment, idx) => (
              <div key={`${attachment.filename ?? "attachment"}-${idx}`} className="relative group flex-shrink-0">
                {attachment.mime.startsWith("image/") ? (
                  <img src={attachment.url} alt={attachment.filename ?? "附件预览"} className="h-[10vh] w-[10vh] rounded-[1.4vh] border border-border object-cover" />
                ) : (
                  <div className="flex h-[10vh] w-[24vw] items-center gap-[1vw] rounded-[1.4vh] border border-border bg-card px-[1.8vw] text-[1.8vh] text-text">
                    <FileText className="h-[2.6vh] w-[2.6vh] flex-shrink-0 text-text-muted" />
                    <span className="truncate">{attachment.filename ?? "附件"}</span>
                  </div>
                )}
                <button
                  onClick={() => removeAttachment(idx)}
                  className="absolute right-[-0.9vh] top-[-0.9vh] rounded-full border border-border bg-card p-[0.35vh] text-accent opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <X className="h-[2vh] w-[2vh]" />
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div
        style={overlay ? { backgroundColor: `rgba(28, 25, 23, ${Math.max(30, Math.min(95, overlayOpacity)) / 100})` } : undefined}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "rounded-[2.4vh] transition-colors",
          overlay
            ? cn(
                "relative h-full border shadow-none backdrop-blur-md focus-within:border-orange-300/40",
                draggingFiles ? "border-orange-300/70 ring-2 ring-orange-300/30" : "border-white/15",
              )
            : "flex min-h-[11vh] items-center gap-[1.8vw] border border-border bg-card px-[2.7vw] py-[1.8vh] shadow-sm focus-within:border-accent/40",
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
        {overlay && !hideOverlayActions ? (
          <div className="absolute left-[1.8vh] right-[1.8vh] top-[1.4vh] z-10 flex items-center justify-end gap-[0.9vh]">
            {hasDialog && (
              <button
                type="button"
                onClick={toggleOverlayMode}
                className="rounded-[1.2vh] p-[1.3vh] text-stone-200 transition-colors hover:bg-white/10 hover:text-white"
                aria-label={isDialogMode ? "切换到输入" : "切换到对话"}
                title={isDialogMode ? "切换到输入" : "切换到对话"}
              >
                {isDialogMode ? <Keyboard className="h-[2.2vh] w-[2.2vh]" /> : <MessageSquare className="h-[2.2vh] w-[2.2vh]" />}
              </button>
            )}
            {!isDialogMode && (
              <button
                type="button"
                onClick={handleFilePick}
                className="rounded-[1.2vh] p-[1.3vh] text-stone-200 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="添加附件"
                title="添加附件"
              >
                <Paperclip className="h-[2.2vh] w-[2.2vh]" />
              </button>
            )}
            <button
              type="button"
              onClick={onHistory}
              className="rounded-[1.2vh] p-[1.3vh] text-stone-200 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="历史会话"
              title="历史会话"
            >
              <History className="h-[2.2vh] w-[2.2vh]" />
            </button>
            {isDialogMode && (
              <button
                type="button"
                onClick={previousOutput}
                disabled={outputIndex === 0}
                className="rounded-[1.2vh] p-[1.3vh] text-stone-200 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
                aria-label="上一条"
                title="上一条"
              >
                <ChevronLeft className="h-[2.2vh] w-[2.2vh]" />
              </button>
            )}
            <button
              type="button"
              onPointerDown={handleDragPointerDown}
              onPointerUp={clearDragTimer}
              onPointerLeave={clearDragTimer}
              onPointerCancel={clearDragTimer}
              onContextMenu={(event) => event.preventDefault()}
              className="rounded-[1.2vh] p-[1.3vh] text-stone-200 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="长按移动窗口"
              title="长按移动窗口"
            >
              <Move className="h-[2.2vh] w-[2.2vh]" />
            </button>
            {!isDialogMode && (
              <motion.button
                type="button"
                initial={false}
                animate={{
                  scale: input.trim() || attachments.length > 0 ? 1 : 0.8,
                  opacity: input.trim() || attachments.length > 0 ? 1 : 0.45,
                }}
                onClick={handleSend}
                disabled={disabled || (!input.trim() && attachments.length === 0)}
                className="rounded-[1.2vh] p-[1.3vh] text-orange-300 transition-colors hover:bg-orange-300/10 disabled:cursor-not-allowed"
                aria-label="发送"
                title="发送"
              >
                <Send className="h-[2.2vh] w-[2.2vh]" />
              </motion.button>
            )}
          </div>
        ) : !overlay ? (
          <button
            onClick={handleFilePick}
            className="flex-shrink-0 rounded-[1.2vh] p-[1.4vh] text-text-muted transition-colors hover:bg-bg hover:text-accent"
            aria-label="添加附件"
            title="添加附件"
          >
            <Paperclip className="h-[2.9vh] w-[2.9vh]" />
          </button>
        ) : null}

        {isDialogMode ? (
          <div
            onClick={advanceOutput}
            className="absolute inset-0 box-border h-full w-full cursor-pointer overflow-y-auto overflow-x-hidden px-[2.2vh] py-[2.2vh] text-left text-[1.72vh] leading-relaxed text-stone-100 [overflow-wrap:anywhere] [&::-webkit-scrollbar]:hidden"
          >
            {currentOutput ? (
              <div>
                {currentOutput.runtimeTrace && (
                  <details
                    className="mb-3 rounded-lg border border-teal-200/15 bg-teal-300/10 px-3 py-2"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <summary className="cursor-pointer select-none text-[11px] tracking-[0.14em] text-teal-100/85">
                      运行过程
                    </summary>
                    <div className="mt-2 whitespace-pre-wrap text-sm text-stone-200 [overflow-wrap:anywhere]">
                      {currentOutput.runtimeTrace}
                    </div>
                  </details>
                )}
                {currentOutput.thinking && (
                  <details
                    className="mb-3 rounded-lg border border-sky-200/15 bg-sky-300/10 px-3 py-2"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <summary className="cursor-pointer select-none text-[11px] tracking-[0.14em] text-sky-100/85">
                      思考
                    </summary>
                    <div className="mt-2 whitespace-pre-wrap text-sm text-stone-200 [overflow-wrap:anywhere]">
                      {currentOutput.thinking}
                    </div>
                  </details>
                )}
                {currentOutput.tool && (
                  <details
                    className="mb-3 rounded-lg border border-emerald-200/15 bg-emerald-300/10 px-3 py-2"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <summary className="cursor-pointer select-none text-[11px] tracking-[0.14em] text-emerald-100/85">
                      工具: {currentOutput.tool.name}
                    </summary>
                    <div className="mt-2 grid gap-2 text-xs text-stone-200">
                      <div>
                        状态: {currentOutput.tool.status}
                        {currentOutput.tool.duration ? ` · ${currentOutput.tool.duration}ms` : ""}
                      </div>
                      <pre className="whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 p-2 [overflow-wrap:anywhere]">
                        {currentOutput.tool.input}
                      </pre>
                      {currentOutput.tool.output && (
                        <pre className="whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 p-2 [overflow-wrap:anywhere]">
                          {currentOutput.tool.output}
                        </pre>
                      )}
                      {currentOutput.tool.error && (
                        <pre className="whitespace-pre-wrap rounded-lg border border-red-300/20 bg-red-950/30 p-2 text-red-100 [overflow-wrap:anywhere]">
                          {currentOutput.tool.error}
                        </pre>
                      )}
                    </div>
                  </details>
                )}
                {currentOutput.text && (
                  <MarkdownContent
                    content={currentOutput.text}
                    imageClassName="my-2 max-h-32 max-w-full rounded-lg border border-white/10 object-contain"
                    paragraphClassName="mb-3 last:mb-0"
                  />
                )}
                {currentOutput.images && currentOutput.images.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {currentOutput.images.map((image, index) => {
                      const src = resolveMonAgentUrl(image)
                      return (
                        <img
                          key={`${image}-${index}`}
                          src={src}
                          alt="会话图片"
                          onClick={(event) => {
                            event.stopPropagation()
                            onPreviewImage?.(src, "会话图片")
                          }}
                          className="max-h-32 max-w-full cursor-pointer rounded-lg border border-white/10 object-contain transition-opacity hover:opacity-85"
                        />
                      )
                    })}
                  </div>
                )}
              </div>
            ) : (
              <span className="text-stone-300">{assistantName}正在回复…</span>
            )}
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="输入消息…（Shift+Enter 换行）"
            rows={overlay ? 10 : 1}
            style={overlay ? { height: "100%", overflow: "hidden", scrollbarWidth: "none" } : undefined}
            className={cn(
              "resize-none overflow-x-hidden overflow-y-hidden bg-transparent outline-none leading-relaxed select-text",
              overlay
                ? "absolute inset-0 box-border h-full max-h-none min-h-0 w-full overflow-hidden px-[2.2vh] py-[2.2vh] text-stone-100 placeholder:text-stone-400 [&::-webkit-scrollbar]:hidden"
                : "min-h-[5vh] max-h-[24vh] min-w-0 flex-1 py-[0.8vh] text-[2.45vh] text-text placeholder:text-text-muted",
            )}
          />
        )}

        {!overlay && (
          <motion.button
            initial={false}
            animate={{
              scale: input.trim() || attachments.length > 0 ? 1 : 0.8,
              opacity: input.trim() || attachments.length > 0 ? 1 : 0.3,
            }}
            onClick={handleSend}
            disabled={disabled || (!input.trim() && attachments.length === 0)}
            className="flex-shrink-0 rounded-[1.2vh] p-[1.4vh] text-accent transition-colors hover:bg-accent/10 disabled:cursor-not-allowed"
          >
            <Send className="h-[2.9vh] w-[2.9vh]" />
          </motion.button>
        )}
      </div>
    </div>
  )
}
