import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, ChevronRight, FileCode2, Layers3, RotateCcw, ScanSearch } from 'lucide-react';
import type { MetaPartCard as MetaPartCardData } from '../types';
import { cn } from '../lib/utils';

interface MetaPartCardProps {
  part: MetaPartCardData;
}

function iconForType(type: string) {
  switch (type) {
    case 'patch':
      return <FileCode2 className="h-4 w-4" />;
    case 'retry':
      return <RotateCcw className="h-4 w-4" />;
    case 'snapshot':
    case 'compaction':
      return <ScanSearch className="h-4 w-4" />;
    default:
      return <Layers3 className="h-4 w-4" />;
  }
}

function toneClass(tone: MetaPartCardData['tone']) {
  switch (tone) {
    case 'accent':
      return 'border-accent/25 text-accent';
    case 'warning':
      return 'border-amber-500/30 text-amber-400';
    case 'muted':
      return 'border-border text-text-muted';
    default:
      return 'border-border text-text';
  }
}

export function MetaPartCard({ part }: MetaPartCardProps) {
  const [expanded, setExpanded] = useState(part.tone === 'warning' || part.type === 'subtask');

  return (
    <div className="my-2 max-w-2xl overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-white/5"
      >
        <span className={cn('mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border bg-bg', toneClass(part.tone))}>
          {iconForType(part.type)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-serif text-sm text-text">{part.title}</span>
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-text-muted">
              {part.type}
            </span>
          </div>
          {part.summary && <div className="mt-1 text-xs leading-relaxed text-text-muted">{part.summary}</div>}
        </div>
        <span className="mt-0.5 flex-shrink-0 text-text-muted">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && part.detail && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border bg-bg px-3 py-3">
              <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-text-muted">{part.detail}</pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
