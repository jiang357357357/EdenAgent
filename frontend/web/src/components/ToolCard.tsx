import { useState } from 'react';
import { ChevronDown, ChevronRight, Wrench, Search, Code, Terminal, Eye, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ToolCall } from '../types';
import { cn } from '../lib/utils';

interface ToolCardProps {
  tool: ToolCall;
}

export function ToolCard({ tool }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);

  const getIcon = () => {
    switch (tool.name.toLowerCase()) {
      case 'search': return <Search className="h-[1.72vh] w-[1.72vh]" />;
      case 'write': return <Code className="h-[1.72vh] w-[1.72vh]" />;
      case 'shell': return <Terminal className="h-[1.72vh] w-[1.72vh]" />;
      case 'vision': return <Eye className="h-[1.72vh] w-[1.72vh]" />;
      default: return <Wrench className="h-[1.72vh] w-[1.72vh]" />;
    }
  };

  const getStatusColor = () => {
    if (tool.status === 'error') return 'text-red-500';
    if (tool.status === 'running') return 'text-accent animate-pulse';
    return 'text-accent';
  };

  const getStatusLabel = () => {
    if (tool.status === 'error') return '失败';
    if (tool.status === 'running') return '运行中';
    return '完成';
  };

  return (
    <div className="my-[0.85vh] max-w-2xl overflow-hidden rounded-[1.35vh] border border-border bg-card text-[1.52vh] shadow-sm transition-all">
      <button 
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-[1.05vh] p-[1.15vh] text-left transition-colors hover:bg-white/5"
      >
        <span className={cn("flex h-[2.65vh] w-[2.65vh] flex-shrink-0 items-center justify-center rounded-[0.75vh] border border-border bg-bg", getStatusColor())}>
          {getIcon()}
        </span>
        <div className="flex min-w-0 flex-grow items-center gap-[0.8vh] font-serif text-[1.58vh] text-text">
          工具: {tool.name}
          <span className="max-w-[24vh] truncate font-sans text-[1.34vh] font-normal text-text-muted">
            {tool.input.length > 30 ? tool.input.substring(0, 30) + '...' : tool.input}
          </span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-[0.75vh] font-sans text-[1.32vh] uppercase tracking-[0.12em] text-text-muted">
          <span
            className={cn(
              'rounded-full border px-[0.85vh] py-[0.18vh] text-[1.18vh] tracking-[0.11em]',
              tool.status === 'error'
                ? 'border-red-500/30 text-red-400'
                : tool.status === 'running'
                  ? 'border-accent/30 text-accent'
                  : 'border-border text-text-muted',
            )}
          >
            {getStatusLabel()}
          </span>
          {tool.duration && <span>{tool.duration}ms</span>}
          {tool.status === 'error' && <AlertCircle className="h-[1.72vh] w-[1.72vh] text-red-500" />}
          {expanded ? <ChevronDown className="h-[1.72vh] w-[1.72vh]" /> : <ChevronRight className="h-[1.72vh] w-[1.72vh]" />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="grid gap-[1.15vh] border-t border-border bg-bg p-[1.15vh]">
              <div>
                <div className="mb-[0.45vh] text-[1.18vh] font-semibold uppercase tracking-[0.14em] text-text-muted">输入</div>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded-[1vh] border border-border bg-card p-[0.85vh] font-mono text-[1.34vh] leading-[1.58] text-text">
                  {tool.input}
                </pre>
              </div>

              {tool.status === 'running' && !tool.output && !tool.error && (
                <div className="rounded-[1vh] border border-accent/20 bg-accent/5 px-[1.1vh] py-[0.8vh] text-[1.34vh] text-text-muted">
                  正在执行中...
                </div>
              )}
              
              {tool.output && (
                <div>
                  <div className="mb-[0.45vh] text-[1.18vh] font-semibold uppercase tracking-[0.14em] text-text-muted">输出</div>
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded-[1vh] border border-border bg-card p-[0.85vh] font-mono text-[1.34vh] leading-[1.58] text-text-lighter">
                    {tool.output}
                  </pre>
                </div>
              )}
              
              {tool.error && (
                <div>
                  <div className="mb-[0.45vh] text-[1.18vh] font-semibold uppercase tracking-[0.14em] text-red-500/70">错误</div>
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded-[1vh] border border-red-900/30 bg-red-950/20 p-[0.85vh] font-mono text-[1.34vh] leading-[1.58] text-red-400">
                    {tool.error}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
