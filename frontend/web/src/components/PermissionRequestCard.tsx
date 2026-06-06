import { useMemo, useState } from 'react';
import { Check, ShieldAlert, X } from 'lucide-react';
import type { PendingPermission } from '../types';
import { cn } from '../lib/utils';

interface PermissionRequestCardProps {
  request: PendingPermission;
  onReply: (requestID: string, reply: 'once' | 'always' | 'reject', message?: string) => Promise<void>;
  tone?: 'default' | 'overlay';
}

function stringify(value: unknown) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function PermissionRequestCard({ request, onReply, tone = 'default' }: PermissionRequestCardProps) {
  const [submitting, setSubmitting] = useState<'once' | 'always' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const metadata = useMemo(() => {
    const entries = Object.entries(request.metadata ?? {});
    if (entries.length === 0) return '';
    return entries.map(([key, value]) => `${key}: ${stringify(value)}`).join('\n\n');
  }, [request.metadata]);

  async function handleReply(reply: 'once' | 'always' | 'reject') {
    setSubmitting(reply);
    setError(null);
    try {
      await onReply(request.id, reply);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div
      className={cn(
        'rounded-2xl border px-4 py-4',
        tone === 'overlay'
          ? 'border-orange-300/15 bg-stone-950/78 text-stone-100 shadow-none backdrop-blur-md'
          : 'border-amber-500/20 bg-card shadow-sm',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border',
            tone === 'overlay'
              ? 'border-orange-300/20 bg-orange-300/10 text-orange-200'
              : 'border-amber-500/25 bg-amber-500/10 text-amber-400',
          )}
        >
          <ShieldAlert className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('text-[10px] uppercase tracking-[0.15em]', tone === 'overlay' ? 'text-orange-200/80' : 'text-amber-400')}>权限请求</span>
            <span className={cn('text-sm font-medium', tone === 'overlay' ? 'text-stone-50' : 'text-text')}>{request.permission}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {request.patterns.map((pattern) => (
              <span
                key={pattern}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[11px]',
                  tone === 'overlay'
                    ? 'border-white/10 bg-white/5 text-stone-300'
                    : 'border-border bg-bg text-text-muted',
                )}
              >
                {pattern}
              </span>
            ))}
          </div>
          {request.tool && (
            <div className={cn('mt-3 text-xs', tone === 'overlay' ? 'text-stone-400' : 'text-text-muted')}>
              工具调用: {request.tool.callID}
            </div>
          )}
          {metadata && (
            <pre
              className={cn(
                'mt-3 whitespace-pre-wrap overflow-x-auto rounded-xl border p-3 text-xs',
                tone === 'overlay'
                  ? 'border-white/10 bg-black/20 text-stone-300'
                  : 'border-border bg-bg text-text-muted',
              )}
            >
              {metadata}
            </pre>
          )}
          {request.always.length > 0 && (
            <div className={cn('mt-3 text-xs', tone === 'overlay' ? 'text-stone-400' : 'text-text-muted')}>
              可记住: {request.always.join(', ')}
            </div>
          )}
          {error && (
            <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => void handleReply('once')}
              disabled={submitting !== null}
              className={cn(
                'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-colors',
                tone === 'overlay'
                  ? 'border-white/10 bg-white/5 text-stone-100 hover:border-white/20 hover:bg-white/10'
                  : 'border-border bg-bg text-text hover:border-accent/40 hover:text-accent',
                'disabled:cursor-wait disabled:opacity-60',
              )}
            >
              <Check className="h-3.5 w-3.5" />
              本次允许
            </button>
            <button
              onClick={() => void handleReply('always')}
              disabled={submitting !== null}
              className={cn(
                'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-colors',
                tone === 'overlay'
                  ? 'border-orange-300/25 bg-orange-300/10 text-orange-200 hover:border-orange-300/40'
                  : 'border-accent/25 bg-accent/10 text-accent hover:border-accent/40',
                'disabled:cursor-wait disabled:opacity-60',
              )}
            >
              <Check className="h-3.5 w-3.5" />
              始终允许
            </button>
            <button
              onClick={() => void handleReply('reject')}
              disabled={submitting !== null}
              className={cn(
                'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-colors',
                'border-red-500/25 bg-red-500/10 text-red-300 hover:border-red-500/40 disabled:cursor-wait disabled:opacity-60',
              )}
            >
              <X className="h-3.5 w-3.5" />
              拒绝
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
