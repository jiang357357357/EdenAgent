import { useMemo, useState } from 'react';
import { HelpCircle, Send, X } from 'lucide-react';
import type { PendingQuestion } from '../types';
import { cn } from '../lib/utils';

interface QuestionRequestCardProps {
  request: PendingQuestion;
  onReply: (requestID: string, answers: string[][]) => Promise<void>;
  onReject: (requestID: string) => Promise<void>;
  tone?: 'default' | 'overlay';
}

export function QuestionRequestCard({ request, onReply, onReject, tone = 'default' }: QuestionRequestCardProps) {
  const [selected, setSelected] = useState<Record<number, string[]>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState<'reply' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const answers = useMemo(
    () =>
      request.questions.map((item, index) => {
        const picks = selected[index] ?? [];
        const customValue = custom[index]?.trim();
        return customValue ? [...picks, customValue] : picks;
      }),
    [custom, request.questions, selected],
  );

  const canSubmit = answers.length > 0 && answers.every((answer) => answer.length > 0);

  function toggleOption(questionIndex: number, label: string, multiple?: boolean) {
    setSelected((prev) => {
      const current = prev[questionIndex] ?? [];
      if (multiple) {
        return {
          ...prev,
          [questionIndex]: current.includes(label)
            ? current.filter((item) => item !== label)
            : [...current, label],
        };
      }
      return {
        ...prev,
        [questionIndex]: current[0] === label ? [] : [label],
      };
    });
  }

  async function handleReply() {
    if (!canSubmit) return;
    setSubmitting('reply');
    setError(null);
    try {
      await onReply(request.id, answers);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSubmitting(null);
    }
  }

  async function handleReject() {
    setSubmitting('reject');
    setError(null);
    try {
      await onReject(request.id);
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
          ? 'border-sky-300/15 bg-stone-950/78 text-stone-100 shadow-none backdrop-blur-md'
          : 'border-sky-500/20 bg-card shadow-sm',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border',
            tone === 'overlay'
              ? 'border-sky-300/20 bg-sky-300/10 text-sky-200'
              : 'border-sky-500/25 bg-sky-500/10 text-sky-400',
          )}
        >
          <HelpCircle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('text-[10px] uppercase tracking-[0.15em]', tone === 'overlay' ? 'text-sky-200/80' : 'text-sky-400')}>问题确认</span>
            {request.tool && <span className={cn('text-xs', tone === 'overlay' ? 'text-stone-400' : 'text-text-muted')}>工具调用: {request.tool.callID}</span>}
          </div>

          <div className="mt-3 space-y-4">
            {request.questions.map((item, index) => {
              const picked = selected[index] ?? [];
              return (
                <div
                  key={`${request.id}-${index}`}
                  className={cn(
                    'rounded-xl border px-3 py-3',
                    tone === 'overlay'
                      ? 'border-white/10 bg-white/5'
                      : 'border-border bg-bg',
                  )}
                >
                  <div className={cn('text-[10px] uppercase tracking-[0.15em]', tone === 'overlay' ? 'text-stone-400' : 'text-text-muted')}>{item.header}</div>
                  <div className={cn('mt-1 text-sm', tone === 'overlay' ? 'text-stone-100' : 'text-text')}>{item.question}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.options.map((option) => {
                      const active = picked.includes(option.label);
                      return (
                        <button
                          key={option.label}
                          onClick={() => toggleOption(index, option.label, item.multiple)}
                          disabled={submitting !== null}
                          className={cn(
                            'rounded-xl border px-3 py-2 text-left text-xs transition-colors',
                            active
                              ? tone === 'overlay'
                                ? 'border-sky-300/35 bg-sky-300/10 text-stone-100'
                                : 'border-accent/35 bg-accent/10 text-text'
                              : tone === 'overlay'
                                ? 'border-white/10 bg-black/10 text-stone-300 hover:border-white/20 hover:text-stone-100'
                                : 'border-border bg-card text-text-muted hover:border-accent/30 hover:text-text',
                            submitting !== null && 'cursor-wait opacity-70',
                          )}
                          title={option.description}
                        >
                          <div className="font-medium text-current">{option.label}</div>
                          <div className="mt-1 text-[11px] leading-relaxed text-current/80">{option.description}</div>
                        </button>
                      );
                    })}
                  </div>
                  {item.custom !== false && (
                    <input
                      value={custom[index] ?? ''}
                      onChange={(event) => setCustom((prev) => ({ ...prev, [index]: event.target.value }))}
                      disabled={submitting !== null}
                      placeholder="自定义回答"
                      className={cn(
                        'mt-3 w-full rounded-xl border px-3 py-2 text-sm outline-none transition-colors',
                        tone === 'overlay'
                          ? 'border-white/10 bg-black/10 text-stone-100 placeholder:text-stone-500 focus:border-sky-300/35'
                          : 'border-border bg-card text-text placeholder:text-text-muted focus:border-accent/40',
                      )}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {error && (
            <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => void handleReply()}
              disabled={!canSubmit || submitting !== null}
              className={cn(
                'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-colors',
                tone === 'overlay'
                  ? 'border-sky-300/25 bg-sky-300/10 text-sky-200 hover:border-sky-300/40'
                  : 'border-accent/25 bg-accent/10 text-accent hover:border-accent/40',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              <Send className="h-3.5 w-3.5" />
              提交回答
            </button>
            <button
              onClick={() => void handleReject()}
              disabled={submitting !== null}
              className={cn(
                'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-colors',
                tone === 'overlay'
                  ? 'border-white/10 bg-white/5 text-stone-300 hover:border-red-500/30 hover:text-red-300'
                  : 'border-border bg-bg text-text-muted hover:border-red-500/30 hover:text-red-300',
                'disabled:cursor-wait disabled:opacity-60',
              )}
            >
              <X className="h-3.5 w-3.5" />
              暂不处理
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
