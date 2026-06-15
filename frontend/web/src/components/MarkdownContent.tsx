import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { resolveMonAgentUrl } from "../lib/mon_agent_api"

interface MarkdownContentProps {
  content: string
  imageClassName?: string
  paragraphClassName?: string
}

export function MarkdownContent({
  content,
  imageClassName = "my-2 max-w-full rounded-lg border border-border object-contain",
  paragraphClassName,
}: MarkdownContentProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        img: ({ src = "", alt = "" }) => (
          <img src={resolveMonAgentUrl(src)} alt={alt} className={imageClassName} draggable={false} />
        ),
        p: ({ children }) => <p className={paragraphClassName}>{children}</p>,
        table: ({ children }) => (
          <div className="my-[1.6vh] w-full overflow-x-auto rounded-[1.1vh] border border-border">
            <table className="m-0 w-full min-w-max border-collapse text-left text-[0.96em]">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border-b border-border bg-bg/70 px-[1.1vh] py-[0.75vh] font-medium text-text">{children}</th>
        ),
        td: ({ children }) => <td className="border-t border-border px-[1.1vh] py-[0.75vh] align-top">{children}</td>,
        code: ({ children, className }) => {
          const inline = !className
          return inline ? (
            <code className="rounded-[0.45vh] bg-bg px-[0.55vh] py-[0.18vh] font-mono text-[0.9em]">{children}</code>
          ) : (
            <code className={className}>{children}</code>
          )
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
