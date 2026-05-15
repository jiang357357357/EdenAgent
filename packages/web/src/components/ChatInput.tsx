import { useState, useRef, useEffect } from 'react';
import { Send, ImageIcon, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ChatInputProps {
  onSend: (text: string, images: string[]) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [input, setInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [input]);

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
    <div className="sticky bottom-0 z-10 bg-gradient-to-t from-bg via-bg/95 to-transparent pt-2 pb-3">
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

      <div className="flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-2xl shadow-sm focus-within:border-accent/40 transition-colors">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          onClick={handleFilePick}
          className="flex-shrink-0 p-2 text-text-muted hover:text-accent transition-colors rounded-lg hover:bg-bg"
        >
          <ImageIcon className="w-4 h-4" />
        </button>

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="输入消息…（Shift+Enter 换行）"
          rows={1}
          className="flex-1 max-h-[180px] resize-none bg-transparent outline-none text-text placeholder:text-text-muted text-sm leading-snug py-0.5"
        />

        <motion.button
          initial={false}
          animate={{
            scale: input.trim() || images.length > 0 ? 1 : 0.8,
            opacity: input.trim() || images.length > 0 ? 1 : 0.3,
          }}
          onClick={handleSend}
          disabled={disabled || (!input.trim() && images.length === 0)}
          className="flex-shrink-0 p-2 text-accent rounded-lg hover:bg-accent/10 transition-colors disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
        </motion.button>
      </div>
    </div>
  );
}
