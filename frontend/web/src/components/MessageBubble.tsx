import { MessageData } from '../types';
import { ToolCard } from './ToolCard';
import { ThinkingBlock } from './ThinkingBlock';
import { MetaPartCard } from './MetaPartCard';
import { cn } from '../lib/utils';
import { resolveOpencodeUrl } from '../lib/opencode';
import ReactMarkdown from 'react-markdown';
import { User } from 'lucide-react';

interface MessageBubbleProps {
  message: MessageData;
  onPreviewImage?: (src: string, alt?: string) => void;
}

export function MessageBubble({ message, onPreviewImage }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <div className={cn("group flex gap-4 w-full px-4 py-6 md:px-0", isUser ? "flex-row-reverse" : "flex-row")}>
      
      {/* Avatar */}
      <div className={cn(
        "flex-shrink-0 w-8 h-8 flex items-center justify-center rounded text-sm overflow-hidden",
        isUser ? "bg-card border border-accent text-accent" : "bg-card border border-border text-text font-serif"
      )}>
        {isUser ? <User className="w-4 h-4" /> : "O"}
      </div>

      {/* Message Content Container */}
      <div className={cn(
        "flex flex-col gap-2 max-w-[80%] min-w-0",
        isUser ? "items-end" : "items-start"
      )}>
        <div className="flex items-center gap-2 px-1">
          <span className="text-[10px] uppercase tracking-[0.1em] text-text-muted">
            {isUser ? 'You' : 'Aeterna'}
          </span>
          <span className="text-[10px] text-text-muted/50">
            {message.timestamp}
          </span>
        </div>

        {/* Attachments (Images) */}
        {message.images && message.images.length > 0 && (
          <div className="flex gap-2 flex-wrap mb-2">
            {message.images.map((img, idx) => (
              <img 
                key={idx}
                src={resolveOpencodeUrl(img)}
                alt="Uploaded" 
                onClick={() => onPreviewImage?.(resolveOpencodeUrl(img), 'Uploaded')}
                className={cn(
                  "rounded-xl object-cover max-w-xs shadow-sm border border-border cursor-pointer hover:opacity-90 transition-opacity",
                  isUser ? "h-32 w-auto" : "w-64 h-auto"
                )}
              />
            ))}
          </div>
        )}

        {/* Assistant Thinking */}
        {!isUser && message.thinking && (
          <ThinkingBlock content={message.thinking} state={message.thinkingState} />
        )}

        {/* Assistant Tool Calls */}
        {!isUser && message.toolCalls && message.toolCalls.map((tool) => (
          <ToolCard key={tool.id} tool={tool} />
        ))}

        {!isUser && message.metaParts && message.metaParts.map((part) => (
          <MetaPartCard key={part.id} part={part} />
        ))}

        {/* Main Content Bubble */}
        {message.content && (
          <div className={cn(
            "relative px-5 py-3.5 text-[15px] leading-relaxed",
            isUser ? "bg-card border border-border text-text rounded-2xl rounded-tr-sm font-sans" : 
                    "bg-transparent text-text w-full prose prose-sm max-w-none"
          )}>
            {isUser ? (
               <div className="whitespace-pre-wrap">{message.content}</div>
            ) : (
               <div className="markdown-body">
                 <ReactMarkdown>{message.content}</ReactMarkdown>
             </div>
           )}
          </div>
        )}

        {!isUser && !message.content && message.isStreaming && (!message.toolCalls || message.toolCalls.length === 0) && (
          <div className="px-1 text-sm text-text-muted">
            正在组织回复...
          </div>
        )}
      </div>
    </div>
  );
}
