import { useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { Sparkles, ChevronDown, ChevronRight } from "lucide-react"
import ReactMarkdown from "react-markdown"
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
    <div className="my-2 max-w-3xl">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-[11px] uppercase tracking-[0.1em] font-sans text-text-muted hover:text-text transition-colors py-1 select-none"
      >
        <Sparkles className={`w-3.5 h-3.5 text-accent ${isStreaming ? "animate-pulse" : ""}`} />
        <span>{displayTitle}</span>
        {!expanded && preview && (
          <span className="max-w-[22rem] truncate text-[11px] normal-case tracking-normal text-text-muted/70">
            {preview}
          </span>
        )}
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="pl-4 py-2 mt-1 border-l border-accent/20">
              {isStreaming && (
                <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-accent/80">{detailTitle}</div>
              )}
              <div className="prose prose-sm text-text-muted leading-relaxed max-w-none text-sm font-sans">
                <ReactMarkdown>{visibleContent}</ReactMarkdown>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
