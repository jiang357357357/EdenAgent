import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, ChevronDown, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface ThinkingBlockProps {
  content: string;
}

export function ThinkingBlock({ content }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-2 max-w-3xl">
      <button 
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-[11px] uppercase tracking-[0.1em] font-sans text-text-muted hover:text-text transition-colors py-1 select-none"
      >
        <Sparkles className="w-3.5 h-3.5 text-accent" />
        <span>REASONING</span>
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="pl-4 py-2 mt-1 border-l border-accent/20">
              <div className="prose prose-sm text-text-muted leading-relaxed max-w-none text-sm font-sans">
                <ReactMarkdown>{content}</ReactMarkdown>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
