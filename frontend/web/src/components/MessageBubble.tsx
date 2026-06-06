import type { MessageData, MessageSegment } from "../types"
import { ToolCard } from "./ToolCard"
import { ThinkingBlock } from "./ThinkingBlock"
import { MetaPartCard } from "./MetaPartCard"
import { cn } from "../lib/utils"
import { resolveMonAgentUrl } from "../lib/mon_agent_api"
import ReactMarkdown from "react-markdown"
import { User } from "lucide-react"
import { useTypewriterText } from "../hooks/useTypewriterText"

interface MessageBubbleProps {
  message: MessageData
  userAvatarUrl?: string
  assistantName?: string
  assistantInitial?: string
  assistantAvatarUrl?: string
  onPreviewImage?: (src: string, alt?: string) => void
  onTextReveal?: () => void
}

interface TextSegmentProps {
  segment: Extract<MessageSegment, { type: "text" }>
  isUser: boolean
  messageId: string
  isMessageStreaming?: boolean
  onTextReveal?: () => void
}

function TextSegment({ segment, isUser, messageId, isMessageStreaming, onTextReveal }: TextSegmentProps) {
  const visibleContent = useTypewriterText({
    active: !isUser && Boolean(isMessageStreaming) && segment.state === "streaming",
    cacheKey: `${messageId}:${segment.id}`,
    target: segment.content,
    onFrame: onTextReveal,
  })

  return (
    <div
      className={cn(
        "relative px-5 py-3.5 text-[15px] leading-relaxed",
        isUser
          ? "bg-card border border-border text-text rounded-2xl rounded-tr-sm font-sans"
          : "bg-transparent text-text w-full prose prose-sm max-w-none",
      )}
    >
      {isUser ? (
        <div className="whitespace-pre-wrap">{visibleContent}</div>
      ) : (
        <div className="markdown-body">
          <ReactMarkdown>{visibleContent}</ReactMarkdown>
        </div>
      )}
    </div>
  )
}

export function MessageBubble({
  message,
  userAvatarUrl,
  assistantName = "助手",
  assistantInitial = "助",
  assistantAvatarUrl,
  onPreviewImage,
  onTextReveal,
}: MessageBubbleProps) {
  const isUser = message.role === "user"
  const orderedSegments = message.segments && message.segments.length > 0 ? message.segments : undefined
  const useOrderedAssistantSegments = !isUser && Boolean(orderedSegments)
  const renderedContent = message.content

  return (
    <div className={cn("group flex gap-4 w-full px-4 py-6 md:px-0", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      <div
        className={cn(
          "flex-shrink-0 w-8 h-8 flex items-center justify-center rounded text-sm overflow-hidden",
          isUser ? "bg-card border border-accent text-accent" : "bg-card border border-border text-text font-serif",
        )}
      >
        {isUser && userAvatarUrl ? (
          <img src={userAvatarUrl} alt="用户头像" className="h-full w-full object-cover" draggable={false} />
        ) : isUser ? (
          <User className="w-4 h-4" />
        ) : assistantAvatarUrl ? (
          <img src={assistantAvatarUrl} alt={assistantName} className="h-full w-full object-cover" draggable={false} />
        ) : (
          assistantInitial
        )}
      </div>

      {/* Message Content Container */}
      <div className={cn("flex flex-col gap-2 max-w-[80%] min-w-0", isUser ? "items-end" : "items-start")}>
        <div className="flex items-center gap-2 px-1">
          <span className="text-[10px] uppercase tracking-[0.1em] text-text-muted">
            {isUser ? "你" : assistantName}
          </span>
          <span className="text-[10px] text-text-muted/50">{message.timestamp}</span>
        </div>

        {/* Attachments (Images) */}
        {!useOrderedAssistantSegments && message.images && message.images.length > 0 && (
          <div className="flex gap-2 flex-wrap mb-2">
            {message.images.map((img, idx) => (
              <img
                key={idx}
                src={resolveMonAgentUrl(img)}
                alt="上传图片"
                onClick={() => onPreviewImage?.(resolveMonAgentUrl(img), "上传图片")}
                className={cn(
                  "rounded-xl object-cover max-w-xs shadow-sm border border-border cursor-pointer hover:opacity-90 transition-opacity",
                  isUser ? "h-32 w-auto" : "w-64 h-auto",
                )}
              />
            ))}
          </div>
        )}

        {useOrderedAssistantSegments
          ? orderedSegments?.map((segment) => {
              if (segment.type === "text") {
                return (
                  <TextSegment
                    key={segment.id}
                    segment={segment}
                    isUser={false}
                    messageId={message.id}
                    isMessageStreaming={message.isStreaming}
                    onTextReveal={onTextReveal}
                  />
                )
              }
              if (segment.type === "runtimeTrace") {
                return (
                  <ThinkingBlock
                    key={segment.id}
                    content={segment.content}
                    state={segment.state}
                    title="运行过程"
                    cacheKey={`${message.id}:${segment.id}`}
                    onTextReveal={onTextReveal}
                  />
                )
              }
              if (segment.type === "thinking") {
                return (
                  <ThinkingBlock
                    key={segment.id}
                    content={segment.content}
                    state={segment.state}
                    cacheKey={`${message.id}:${segment.id}`}
                    onTextReveal={onTextReveal}
                  />
                )
              }
              if (segment.type === "tool") {
                return <ToolCard key={segment.id} tool={segment.tool} />
              }
              if (segment.type === "meta") {
                return <MetaPartCard key={segment.id} part={segment.part} />
              }
              if (segment.type === "image") {
                const src = resolveMonAgentUrl(segment.url)
                return (
                  <img
                    key={segment.id}
                    src={src}
                    alt={segment.filename || "图片"}
                    onClick={() => onPreviewImage?.(src, segment.filename || "图片")}
                    className="mb-2 h-auto w-64 cursor-pointer rounded-xl border border-border object-cover shadow-sm transition-opacity hover:opacity-90"
                    draggable={false}
                  />
                )
              }
              return null
            })
          : null}

        {/* Assistant Runtime Trace */}
        {!useOrderedAssistantSegments && !isUser && message.runtimeTrace && (
          <ThinkingBlock
            content={message.runtimeTrace}
            state={message.runtimeTraceState}
            title="运行过程"
            cacheKey={`${message.id}:runtime`}
            onTextReveal={onTextReveal}
          />
        )}

        {/* Assistant Thinking */}
        {!useOrderedAssistantSegments && !isUser && message.thinking && (
          <ThinkingBlock
            content={message.thinking}
            state={message.thinkingState}
            cacheKey={`${message.id}:thinking`}
            onTextReveal={onTextReveal}
          />
        )}

        {/* Assistant Tool Calls */}
        {!useOrderedAssistantSegments &&
          !isUser &&
          message.toolCalls &&
          message.toolCalls.map((tool) => <ToolCard key={tool.id} tool={tool} />)}

        {!useOrderedAssistantSegments &&
          !isUser &&
          message.metaParts &&
          message.metaParts.map((part) => <MetaPartCard key={part.id} part={part} />)}

        {/* Main Content Bubble */}
        {!useOrderedAssistantSegments && renderedContent && (
          <TextSegment
            segment={{
              id: `${message.id}:content`,
              type: "text",
              content: renderedContent,
              state: message.isStreaming ? "streaming" : "done",
            }}
            isUser={isUser}
            messageId={message.id}
            isMessageStreaming={message.isStreaming}
            onTextReveal={onTextReveal}
          />
        )}

        {!isUser &&
          !message.content &&
          message.isStreaming &&
          (!message.toolCalls || message.toolCalls.length === 0) && (
            <div className="px-1 text-sm text-text-muted">正在组织回复...</div>
          )}
      </div>
    </div>
  )
}
