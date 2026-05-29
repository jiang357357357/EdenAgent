import { useState } from 'react';
import { ChevronDown, ChevronRight, Wrench, Search, Code, Terminal, Eye, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ToolCall } from '../types';
import { cn } from '../lib/utils';

interface ToolCardProps {
  tool: ToolCall;
}

export function ToolCard({ tool }: ToolCardProps) {
  const [expanded, setExpanded] = useState(tool.status === 'running' || tool.status === 'error');

  const getIcon = () => {
    switch (tool.name.toLowerCase()) {
      case 'search': return <Search className="w-4 h-4" />;
      case 'write': return <Code className="w-4 h-4" />;
      case 'shell': return <Terminal className="w-4 h-4" />;
      case 'vision': return <Eye className="w-4 h-4" />;
      default: return <Wrench className="w-4 h-4" />;
    }
  };

  const getStatusColor = () => {
    if (tool.status === 'error') return 'text-red-500';
    if (tool.status === 'running') return 'text-accent animate-pulse';
    return 'text-accent';
  };

  const getStatusLabel = () => {
    if (tool.status === 'error') return 'error';
    if (tool.status === 'running') return 'running';
    return 'done';
  };

  return (
    <div className="my-2 border border-border rounded-xl overflow-hidden bg-card shadow-sm max-w-2xl text-sm transition-all">
      <button 
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-3 hover:bg-white/5 transition-colors text-left"
      >
        <span className={cn("flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-md bg-bg border border-border", getStatusColor())}>
          {getIcon()}
        </span>
        <div className="flex-grow flex items-center gap-2 text-text font-serif">
          工具: {tool.name}
          <span className="text-text-muted font-sans font-normal truncate max-w-[200px] text-xs">
            {tool.input.length > 30 ? tool.input.substring(0, 30) + '...' : tool.input}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 text-xs text-text-muted font-sans uppercase tracking-widest">
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 text-[10px] tracking-[0.15em]',
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
          {tool.status === 'error' && <AlertCircle className="w-4 h-4 text-red-500" />}
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
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
            <div className="p-3 bg-bg border-t border-border grid gap-3">
              <div>
                <div className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.2em] mb-1">输入</div>
                <pre className="text-xs text-text font-mono whitespace-pre-wrap overflow-x-auto bg-card border border-border p-2 rounded-lg">
                  {tool.input}
                </pre>
              </div>

              {tool.status === 'running' && !tool.output && !tool.error && (
                <div className="rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-text-muted">
                  正在执行中...
                </div>
              )}
              
              {tool.output && (
                <div>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.2em] mb-1">输出</div>
                  <pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto bg-card border border-border p-2 rounded-lg text-text-lighter">
                    {tool.output}
                  </pre>
                </div>
              )}
              
              {tool.error && (
                <div>
                  <div className="text-[10px] font-semibold text-red-500/70 uppercase tracking-[0.2em] mb-1">错误</div>
                  <pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto bg-red-950/20 border border-red-900/30 text-red-400 p-2 rounded-lg">
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
