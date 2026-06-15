import { useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { Sparkles, ChevronDown, ChevronRight } from "lucide-react"
import { MarkdownContent } from "./MarkdownContent"
import { useTypewriterText } from "../hooks/useTypewriterText"

interface ThinkingBlockProps {
  content: string
  state?: "streaming" | "done"
  title?: string
  activeTitle?: string
  cacheKey?: string
  onTextReveal?: () => void
}

export function ThinkingBlock({
  content,
  state = "done",
  title = "思考",
  activeTitle,
  cacheKey,
  onTextReveal,
}: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(state === "streaming")
  const isStreaming = state === "streaming"
  const visibleContent = useTypewriterText({
    active: isStreaming,
    cacheKey: cacheKey ?? `${title}:${content.slice(0, 48)}`,
    target: content,
    onFrame: onTextReveal,
  })
  const preview = visibleContent.replace(/\s+/g, " ").trim()
  const displayTitle = isStreaming ? (activeTitle ?? `${title}中`) : title
  const detailTitle = title === "运行过程" ? "正在执行" : "正在推理"

  return (
    <div className="my-[0.85vh] w-full max-w-3xl min-w-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full min-w-0 items-center gap-[0.8vh] py-[0.45vh] text-left font-sans text-[1.42vh] text-text-muted transition-colors hover:text-text select-none"
      >
        <Sparkles className={`h-[1.65vh] w-[1.65vh] flex-shrink-0 text-accent ${isStreaming ? "animate-pulse" : ""}`} />
        <span className="flex-shrink-0 whitespace-nowrap tracking-[0.08em]">{displayTitle}</span>
        {!expanded && preview && (
          <span className="min-w-0 flex-1 truncate text-[1.42vh] normal-case tracking-normal text-text-muted/70">
            {preview}
          </span>
        )}
        {expanded ? (
          <ChevronDown className="h-[1.65vh] w-[1.65vh] flex-shrink-0" />
        ) : (
          <ChevronRight className="h-[1.65vh] w-[1.65vh] flex-shrink-0" />
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-[0.45vh] border-l border-accent/20 py-[0.85vh] pl-[1.6vh]">
              {isStreaming && (
                <div className="mb-[0.85vh] text-[1.22vh] uppercase tracking-[0.12em] text-accent/80">{detailTitle}</div>
              )}
              <div className="prose max-w-none font-sans text-[1.58vh] leading-[1.62] text-text-muted">
                <MarkdownContent content={visibleContent} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
