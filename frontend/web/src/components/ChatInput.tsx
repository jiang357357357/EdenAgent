import { useState, useRef, useEffect } from 'react';
import { Send, ImageIcon, X, History, Move, MessageSquare, Keyboard, ChevronLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { resolveOpencodeUrl } from '../lib/opencode';
import { cn } from '../lib/utils';
import type { ToolCall } from '../types';

type DialogSegment = {
  speaker: string;
  text?: string;
  images?: string[];
  thinking?: string;
  tool?: ToolCall;
};

interface ChatInputProps {
  onSend: (text: string, images: string[]) => void;
  disabled?: boolean;
  overlay?: boolean;
  onHistory?: () => void;
  onStartWindowDrag?: () => void;
  outputActive?: boolean;
  outputContent?: string;
  outputThinking?: string;
  outputTools?: ToolCall[];
  dialogSegments?: DialogSegment[];
  onPreviewImage?: (src: string, alt?: string) => void;
}

export function ChatInput({
  onSend,
  disabled,
  overlay = false,
  onHistory,
  onStartWindowDrag,
  outputActive = false,
  outputContent = '',
  outputThinking,
  outputTools = [],
  dialogSegments,
  onPreviewImage,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragTimerRef = useRef<number | undefined>(undefined);
  const previousSegmentCountRef = useRef(0);
  const outputToolsKey = outputTools.map((tool) => `${tool.id}:${tool.status}:${tool.duration ?? ''}`).join('|');
  const fallbackOutputSegments: DialogSegment[] = [
    ...(outputThinking ? [{ speaker: '苏岚', thinking: outputThinking }] : []),
    ...outputTools.map((tool) => ({
      speaker: '苏岚',
      tool,
    })),
    ...outputContent
      .split(/\n{2,}/)
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => ({ speaker: '苏岚', text })),
  ];
  const outputSegments = dialogSegments?.length ? dialogSegments : fallbackOutputSegments;
  const [outputIndex, setOutputIndex] = useState(0);
  const [overlayMode, setOverlayMode] = useState<'input' | 'dialog'>('input');
  const hasDialog = overlay && (outputActive || outputSegments.length > 0);
  const isDialogMode = overlay && overlayMode === 'dialog' && hasDialog;
  const currentOutput = outputSegments[Math.min(outputIndex, Math.max(outputSegments.length - 1, 0))];

  useEffect(() => {
    const previousCount = previousSegmentCountRef.current;
    const nextCount = outputSegments.length;
    previousSegmentCountRef.current = nextCount;

    setOutputIndex(Math.max(outputSegments.length - 1, 0));
    if (overlay && (outputActive || nextCount > previousCount)) setOverlayMode('dialog');
  }, [outputActive, outputContent, outputThinking, outputToolsKey, outputSegments.length]);

  useEffect(() => {
    if (textareaRef.current) {
      if (overlay) {
        textareaRef.current.style.height = '';
        return;
      }
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [input, overlay]);

  const handleSend = () => {
    if ((!input.trim() && images.length === 0) || disabled) return;
    onSend(input.trim(), images);
    setInput('');
    setImages([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.indexOf('image') === 0) {
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (e) => {
            if (e.target?.result && typeof e.target.result === 'string') {
              setImages(prev => [...prev, e.target!.result as string]);
            }
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const handleFilePick = () => {
    fileInputRef.current?.click();
  };

  const clearDragTimer = () => {
    if (dragTimerRef.current !== undefined) {
      window.clearTimeout(dragTimerRef.current);
      dragTimerRef.current = undefined;
    }
  };

  const handleDragPointerDown = () => {
    if (!onStartWindowDrag) return;
    clearDragTimer();
    dragTimerRef.current = window.setTimeout(() => {
      dragTimerRef.current = undefined;
      onStartWindowDrag();
    }, 220);
  };

  const advanceOutput = () => {
    if (!isDialogMode) return;
    setOutputIndex((index) => {
      if (index >= outputSegments.length - 1) {
        setOverlayMode('input');
        return index;
      }
      return index + 1;
    });
  };

  const previousOutput = () => {
    if (!isDialogMode) return;
    setOutputIndex((index) => Math.max(index - 1, 0));
  };

  const toggleOverlayMode = () => {
    if (!hasDialog) return;
    setOverlayMode((mode) => mode === 'dialog' ? 'input' : 'dialog');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result && typeof e.target.result === 'string') {
          setImages(prev => [...prev, e.target!.result as string]);
        }
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className={cn(
      "sticky bottom-0 z-10",
      overlay ? "h-[40vh] bg-transparent p-0" : "bg-gradient-to-t from-bg via-bg/95 to-transparent pt-2 pb-3"
    )}>
      <AnimatePresence>
        {images.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="flex gap-2 mb-2 px-2 overflow-x-auto"
          >
            {images.map((img, idx) => (
              <div key={idx} className="relative group flex-shrink-0">
                <img src={img} alt="预览" className="h-14 w-14 object-cover rounded-lg border border-border" />
                <button
                  onClick={() => removeImage(idx)}
                  className="absolute -top-1.5 -right-1.5 bg-card text-accent border border-border rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div className={cn(
        "min-h-[68px] rounded-2xl transition-colors",
        overlay
          ? "relative h-full border border-white/15 bg-stone-950/76 shadow-none backdrop-blur-md focus-within:border-orange-300/40"
          : "flex items-center gap-3 border border-border bg-card px-4 py-3 shadow-sm focus-within:border-accent/40"
      )}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
        {overlay ? (
          <div className="absolute right-3 top-3 z-10 flex flex-col gap-1.5">
            {hasDialog && (
              <button
                type="button"
                onClick={toggleOverlayMode}
                className="rounded-lg p-2.5 text-stone-200 transition-colors hover:bg-white/10 hover:text-white"
                aria-label={isDialogMode ? '切换到输入' : '切换到对话'}
                title={isDialogMode ? '切换到输入' : '切换到对话'}
              >
                {isDialogMode ? <Keyboard className="w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}
              </button>
            )}
            {!isDialogMode && (
              <button
                type="button"
                onClick={handleFilePick}
                className="rounded-lg p-2.5 text-stone-200 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="上传图片"
                title="上传图片"
              >
                <ImageIcon className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onHistory}
              className="rounded-lg p-2.5 text-stone-200 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="历史会话"
              title="历史会话"
            >
              <History className="w-4 h-4" />
            </button>
            {isDialogMode && (
              <button
                type="button"
                onClick={previousOutput}
                disabled={outputIndex === 0}
                className="rounded-lg p-2.5 text-stone-200 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
                aria-label="上一条"
                title="上一条"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onPointerDown={handleDragPointerDown}
              onPointerUp={clearDragTimer}
              onPointerLeave={clearDragTimer}
              onPointerCancel={clearDragTimer}
              onContextMenu={(event) => event.preventDefault()}
              className="rounded-lg p-2.5 text-stone-200 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="长按移动窗口"
              title="长按移动窗口"
            >
              <Move className="w-4 h-4" />
            </button>
            {!isDialogMode && (
              <motion.button
                type="button"
                initial={false}
                animate={{
                  scale: input.trim() || images.length > 0 ? 1 : 0.8,
                  opacity: input.trim() || images.length > 0 ? 1 : 0.45,
                }}
                onClick={handleSend}
                disabled={disabled || (!input.trim() && images.length === 0)}
                className="rounded-lg p-2.5 text-orange-300 transition-colors hover:bg-orange-300/10 disabled:cursor-not-allowed"
                aria-label="发送"
                title="发送"
              >
                <Send className="w-4 h-4" />
              </motion.button>
            )}
          </div>
        ) : (
          <button
            onClick={handleFilePick}
            className="flex-shrink-0 rounded-lg p-2.5 text-text-muted transition-colors hover:bg-bg hover:text-accent"
          >
            <ImageIcon className="w-4 h-4" />
          </button>
        )}

        {isDialogMode ? (
          <div
            onClick={advanceOutput}
            className="absolute inset-0 box-border h-full w-full cursor-pointer overflow-y-auto overflow-x-hidden px-5 py-5 pr-16 text-left text-[15px] leading-relaxed text-stone-100 [overflow-wrap:anywhere] [&::-webkit-scrollbar]:hidden"
          >
            {currentOutput ? (
              <div>
                <div className="mb-3 text-[11px] tracking-[0.18em] text-orange-200/80">
                  {currentOutput.speaker}
                </div>
                {currentOutput.thinking && (
                  <details
                    className="mb-3 rounded-lg border border-sky-200/15 bg-sky-300/10 px-3 py-2"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <summary className="cursor-pointer select-none text-[11px] tracking-[0.14em] text-sky-100/85">
                      思考
                    </summary>
                    <div className="mt-2 whitespace-pre-wrap text-sm text-stone-200 [overflow-wrap:anywhere]">
                      {currentOutput.thinking}
                    </div>
                  </details>
                )}
                {currentOutput.tool && (
                  <details
                    className="mb-3 rounded-lg border border-emerald-200/15 bg-emerald-300/10 px-3 py-2"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <summary className="cursor-pointer select-none text-[11px] tracking-[0.14em] text-emerald-100/85">
                      工具: {currentOutput.tool.name}
                    </summary>
                    <div className="mt-2 grid gap-2 text-xs text-stone-200">
                      <div>状态: {currentOutput.tool.status}{currentOutput.tool.duration ? ` · ${currentOutput.tool.duration}ms` : ''}</div>
                      <pre className="whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 p-2 [overflow-wrap:anywhere]">{currentOutput.tool.input}</pre>
                      {currentOutput.tool.output && (
                        <pre className="whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 p-2 [overflow-wrap:anywhere]">{currentOutput.tool.output}</pre>
                      )}
                      {currentOutput.tool.error && (
                        <pre className="whitespace-pre-wrap rounded-lg border border-red-300/20 bg-red-950/30 p-2 text-red-100 [overflow-wrap:anywhere]">{currentOutput.tool.error}</pre>
                      )}
                    </div>
                  </details>
                )}
                {currentOutput.text && (
                  <ReactMarkdown
                    components={{
                      img: ({ src = '', alt = '' }) => (
                        <img
                          src={resolveOpencodeUrl(src)}
                          alt={alt}
                          className="my-2 max-h-32 max-w-full rounded-lg border border-white/10 object-contain"
                        />
                      ),
                      p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
                    }}
                  >
                    {currentOutput.text}
                  </ReactMarkdown>
                )}
                {currentOutput.images && currentOutput.images.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {currentOutput.images.map((image, index) => {
                      const src = resolveOpencodeUrl(image);
                      return (
                        <img
                          key={`${image}-${index}`}
                          src={src}
                          alt="会话图片"
                          onClick={(event) => {
                            event.stopPropagation();
                            onPreviewImage?.(src, '会话图片');
                          }}
                          className="max-h-32 max-w-full cursor-pointer rounded-lg border border-white/10 object-contain transition-opacity hover:opacity-85"
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <span className="text-stone-300">苏岚正在回复…</span>
            )}
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="输入消息…（Shift+Enter 换行）"
            rows={overlay ? 10 : 1}
            style={overlay ? { height: '100%', overflow: 'hidden', scrollbarWidth: 'none' } : undefined}
            className={cn(
              "resize-none overflow-x-hidden bg-transparent outline-none text-[15px] leading-relaxed",
              overlay
                ? "absolute inset-0 box-border h-full max-h-none min-h-0 w-full overflow-hidden py-5 pl-5 pr-16 text-stone-100 placeholder:text-stone-400 [&::-webkit-scrollbar]:hidden"
                : "min-h-[40px] max-h-[220px] min-w-0 flex-1 py-1 text-text placeholder:text-text-muted"
            )}
          />
        )}

        {!overlay && (
          <motion.button
            initial={false}
            animate={{
              scale: input.trim() || images.length > 0 ? 1 : 0.8,
              opacity: input.trim() || images.length > 0 ? 1 : 0.3,
            }}
            onClick={handleSend}
            disabled={disabled || (!input.trim() && images.length === 0)}
            className="flex-shrink-0 rounded-lg p-2.5 text-accent transition-colors hover:bg-accent/10 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
          </motion.button>
        )}
      </div>
    </div>
  );
}
