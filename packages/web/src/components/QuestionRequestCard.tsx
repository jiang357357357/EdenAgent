import { useMemo, useState } from 'react';
import { HelpCircle, Send, X } from 'lucide-react';
import type { PendingQuestion } from '../types';
import { cn } from '../lib/utils';

interface QuestionRequestCardProps {
  request: PendingQuestion;
  onReply: (requestID: string, answers: string[][]) => Promise<void>;
  onReject: (requestID: string) => Promise<void>;
}

export function QuestionRequestCard({ request, onReply, onReject }: QuestionRequestCardProps) {
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
    <div className="rounded-2xl border border-sky-500/20 bg-card px-4 py-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-sky-500/25 bg-sky-500/10 text-sky-400">
          <HelpCircle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.15em] text-sky-400">Question</span>
            {request.tool && <span className="text-xs text-text-muted">tool call: {request.tool.callID}</span>}
          </div>

          <div className="mt-3 space-y-4">
            {request.questions.map((item, index) => {
              const picked = selected[index] ?? [];
              return (
                <div key={`${request.id}-${index}`} className="rounded-xl border border-border bg-bg px-3 py-3">
                  <div className="text-[10px] uppercase tracking-[0.15em] text-text-muted">{item.header}</div>
                  <div className="mt-1 text-sm text-text">{item.question}</div>
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
                              ? 'border-accent/35 bg-accent/10 text-text'
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
                      className="mt-3 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-accent/40"
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
                'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs transition-colors',
                'border-accent/25 bg-accent/10 text-accent hover:border-accent/40 disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              <Send className="h-3.5 w-3.5" />
              Submit Answers
            </button>
            <button
              onClick={() => void handleReject()}
              disabled={submitting !== null}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs transition-colors',
                'border-border bg-bg text-text-muted hover:border-red-500/30 hover:text-red-300 disabled:cursor-wait disabled:opacity-60',
              )}
            >
              <X className="h-3.5 w-3.5" />
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
