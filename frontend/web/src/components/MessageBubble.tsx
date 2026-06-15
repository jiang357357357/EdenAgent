import type { MessageData, MessageSegment } from "../types"
import { ToolCard } from "./ToolCard"
import { ThinkingBlock } from "./ThinkingBlock"
import { MetaPartCard } from "./MetaPartCard"
import { cn } from "../lib/utils"
import { resolveMonAgentUrl } from "../lib/mon_agent_api"
import { MarkdownContent } from "./MarkdownContent"
import { Code2, User } from "lucide-react"
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
        "relative px-[2.05vh] py-[1.35vh] text-[1.82vh] leading-[1.68]",
        isUser
          ? "bg-card border border-border text-text rounded-[2vh] rounded-tr-[0.45vh] font-sans"
          : "bg-transparent text-text w-full prose max-w-none",
      )}
    >
      {isUser ? (
        <div className="whitespace-pre-wrap">{visibleContent}</div>
      ) : (
        <div className="markdown-body">
          <MarkdownContent content={visibleContent} />
        </div>
      )}
    </div>
  )
}

function RawOutput({ content }: { content: string }) {
  return (
    <details className="mx-[2.05vh] mb-[0.45vh] rounded-[1.1vh] border border-border bg-bg/60 text-[1.42vh] text-text-muted">
      <summary className="flex cursor-pointer select-none items-center gap-[0.8vh] px-[1.2vh] py-[0.8vh]">
        <Code2 className="h-[1.65vh] w-[1.65vh]" />
        原始输出
      </summary>
      <pre className="max-h-[32vh] overflow-auto whitespace-pre-wrap border-t border-border px-[1.2vh] py-[0.8vh] font-mono text-[1.34vh] leading-[1.6] text-text">
        {content}
      </pre>
    </details>
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
    <div className={cn("group flex w-full gap-[1.8vh] px-[1.6vh] py-[2.5vh] md:px-0", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      <div
        className={cn(
          "flex h-[3.8vh] w-[3.8vh] flex-shrink-0 items-center justify-center overflow-hidden rounded-[0.75vh] text-[1.62vh]",
          isUser ? "bg-card border border-accent text-accent" : "bg-card border border-border text-text font-serif",
        )}
      >
        {isUser && userAvatarUrl ? (
          <img src={userAvatarUrl} alt="用户头像" className="h-full w-full object-cover" draggable={false} />
        ) : isUser ? (
          <User className="h-[1.95vh] w-[1.95vh]" />
        ) : assistantAvatarUrl ? (
          <img src={assistantAvatarUrl} alt={assistantName} className="h-full w-full object-cover" draggable={false} />
        ) : (
          assistantInitial
        )}
      </div>

      {/* Message Content Container */}
      <div className={cn("flex max-w-[80%] min-w-0 flex-col gap-[0.85vh]", isUser ? "items-end" : "items-start")}>
        <div className="flex items-center gap-[0.8vh] px-[0.45vh]">
          <span className="text-[1.24vh] uppercase tracking-[0.08em] text-text-muted">
            {isUser ? "你" : assistantName}
          </span>
          <span className="text-[1.24vh] text-text-muted/50">{message.timestamp}</span>
        </div>

        {/* Attachments (Images) */}
        {!useOrderedAssistantSegments && message.images && message.images.length > 0 && (
          <div className="mb-[0.85vh] flex flex-wrap gap-[0.85vh]">
            {message.images.map((img, idx) => (
              <img
                key={idx}
                src={resolveMonAgentUrl(img)}
                alt="上传图片"
                onClick={() => onPreviewImage?.(resolveMonAgentUrl(img), "上传图片")}
                className={cn(
                  "max-w-[32vh] cursor-pointer rounded-[1.35vh] border border-border object-cover shadow-sm transition-opacity hover:opacity-90",
                  isUser ? "h-[16vh] w-auto" : "w-[28vh] h-auto",
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
                    className="mb-[0.85vh] h-auto w-[28vh] cursor-pointer rounded-[1.35vh] border border-border object-cover shadow-sm transition-opacity hover:opacity-90"
                    draggable={false}
                  />
                )
              }
              return null
            })
          : null}

        {useOrderedAssistantSegments && renderedContent && !message.isStreaming && <RawOutput content={renderedContent} />}

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
          <>
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
            {!isUser && !message.isStreaming && <RawOutput content={renderedContent} />}
          </>
        )}

        {!isUser &&
          !message.content &&
          message.isStreaming &&
          (!message.toolCalls || message.toolCalls.length === 0) && (
            <div className="px-[0.45vh] text-[1.65vh] text-text-muted">正在组织回复...</div>
          )}
      </div>
    </div>
  )
}
