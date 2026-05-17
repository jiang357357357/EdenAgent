import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Menu, MessageSquare, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Sidebar } from './components/Sidebar';
import { MessageBubble } from './components/MessageBubble';
import { ChatInput } from './components/ChatInput';
import { CharacterPanel } from './components/CharacterPanel';
import { Session, MessageData } from './types';
import { listenDesktopViewMode, resizeDesktopWindow, setDesktopViewModeState, setDesktopWindowAppearance, startDesktopWindowDrag } from './lib/desktop-window';
import { cn } from './lib/utils';
import {
  createSession,
  listMessages,
  listSessions,
  resolveOpencodeUrl,
  sendPrompt,
  subscribeEvents,
} from './lib/opencode';

const screenTransition = {
  duration: 0.28,
  ease: [0.16, 1, 0.3, 1],
} as const;

const fullScreenMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

const characterScreenMotion = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [isThinking, setIsThinking] = useState(false);
  const [characterMode, setCharacterMode] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyView, setHistoryView] = useState<'messages' | 'sessions'>('messages');
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | undefined>();
  const [connectionError, setConnectionError] = useState<string | undefined>();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  const activeSession = sessions.find(s => s.id === activeSessionId);
  const activeMessages = activeSession?.messages ?? [];
  const lastUserMessageIndex = activeMessages.reduce((lastIndex, message, index) => (
    message.role === 'user' ? index : lastIndex
  ), -1);
  const activeReplyMessage = activeMessages
    .slice(Math.max(lastUserMessageIndex + 1, 0))
    .reverse()
    .find((message) => message.role === 'assistant');
  const dialogSegments = activeMessages.flatMap((message) => {
    const speaker = message.role === 'user' ? '你' : '苏岚';
    const segments: Array<{
      speaker: string;
      text?: string;
      images?: string[];
      thinking?: string;
      tool?: NonNullable<MessageData['toolCalls']>[number];
    }> = [];

    if (message.images?.length) {
      segments.push({
        speaker,
        images: message.images,
      });
    }

    if (message.thinking) {
      segments.push({
        speaker,
        thinking: message.thinking,
      });
    }

    if (message.toolCalls?.length) {
      for (const tool of message.toolCalls) {
        segments.push({
          speaker,
          tool,
        });
      }
    }

    if (message.content) {
      for (const text of message.content.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean)) {
        segments.push({ speaker, text });
      }
    }

    return segments;
  });
  
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages, isThinking]);

  useEffect(() => {
    void resizeDesktopWindow('chatWithCharacter');
    void setDesktopWindowAppearance('chatWithCharacter');
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let disposed = false;

    void listenDesktopViewMode((mode) => {
      switchCharacterMode(mode === 'character');
    }).then((dispose) => {
      if (disposed) {
        dispose?.();
        return;
      }
      cleanup = dispose;
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const loaded = await listSessions();
        if (cancelled) return;
        setConnectionError(undefined);
        setSessions(loaded);
        if (loaded[0]) {
          setActiveSessionId(loaded[0].id);
        }
      } catch (error) {
        if (cancelled) return;
        setConnectionError(error instanceof Error ? error.message : String(error));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeSessionId) return;
    let cancelled = false;

    async function load() {
      try {
        const messages = await listMessages(activeSessionId);
        if (cancelled) return;
        setConnectionError(undefined);
        setSessions((prev) => prev.map((session) => session.id === activeSessionId ? { ...session, messages } : session));
      } catch (error) {
        if (cancelled) return;
        setConnectionError(error instanceof Error ? error.message : String(error));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let disposed = false;

    void subscribeEvents((event) => {
      const properties = 'properties' in event ? event.properties as { sessionID?: string } : undefined;
      if (properties?.sessionID && properties.sessionID !== activeSessionId) return;

      if (
        event.type === 'message.updated' ||
        event.type === 'message.part.updated' ||
        event.type === 'message.part.removed' ||
        event.type === 'session.updated' ||
        event.type === 'session.created'
      ) {
        void listSessions().then((loaded) => {
          setSessions((prev) => loaded.map((session) => ({
            ...session,
            messages: prev.find((item) => item.id === session.id)?.messages ?? [],
          })));
        }).catch(() => undefined);

        if (activeSessionId) {
          void listMessages(activeSessionId).then((messages) => {
            setSessions((prev) => prev.map((session) => session.id === activeSessionId ? { ...session, messages } : session));
          }).catch(() => undefined);
        }
      }

      if (event.type === 'session.status' && properties?.sessionID === activeSessionId) {
        const status = (event.properties as { status?: { type?: string } }).status;
        setIsThinking(status?.type !== 'idle');
      }
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      cleanup = dispose;
    }).catch((error) => {
      setConnectionError(error instanceof Error ? error.message : String(error));
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [activeSessionId]);

  // Handle theme toggle
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const handleSendMessage = async (content: string, images: string[]) => {
    const sessionID = activeSessionId || (await createSession().then((session) => {
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
      return session.id;
    }));

    const newMessage: MessageData = {
      id: Date.now().toString(),
      role: 'user',
      content,
      images: images.length > 0 ? images : undefined,
      timestamp: '刚刚',
    };

    setSessions(prev => prev.map(s => {
      if (s.id === sessionID) {
        return { ...s, messages: [...s.messages, newMessage] };
      }
      return s;
    }));

    setIsThinking(true);

    try {
      setConnectionError(undefined);
      await sendPrompt(sessionID, content.trim(), images);
      const messages = await listMessages(sessionID);
      setSessions((prev) => prev.map((session) => session.id === sessionID ? { ...session, messages } : session));
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsThinking(false);
    }
  };

  const handleNewSession = async () => {
    try {
      const newSession = await createSession();
      setConnectionError(undefined);
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
      setSidebarOpen(false);
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : String(error));
    }
  };

  function switchCharacterMode(enabled: boolean) {
    const mode = enabled ? 'character' : 'chatWithCharacter';
    setCharacterMode(enabled);
    setHistoryOpen(false);
    setHistoryView('messages');
    document.documentElement.classList.toggle('character-transparent', enabled);
    void setDesktopViewModeState(mode);
    void setDesktopWindowAppearance(mode);
    window.setTimeout(() => {
      void resizeDesktopWindow(mode);
    }, 220);
  }

  return (
    <>
    <AnimatePresence mode="wait" initial={false}>
      {characterMode ? (
      <motion.div
        key="character"
        {...characterScreenMotion}
        transition={screenTransition}
        className="h-[100vh] w-[100vw] !bg-transparent text-text font-sans overflow-hidden"
      >
        <main className="relative mx-auto h-[100vh] w-[100vw] overflow-hidden !bg-transparent">
          <section className="pointer-events-none absolute inset-0 flex items-end justify-center text-center">
            <motion.div
              initial={{ opacity: 0, y: 28, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 1 }}
              transition={{ ...screenTransition, delay: 0.08 }}
              className="relative h-[100vh] w-[100vw] overflow-hidden !bg-transparent shadow-none"
            >
              <img
                src={isThinking ? '/characters/sulan/04_thinking_chin_transparent.png' : '/characters/sulan/01_default_stand_transparent.png'}
                alt="苏岚"
                className="absolute bottom-0 left-1/2 h-[100vh] w-auto max-w-none -translate-x-1/2 object-contain object-bottom shadow-none drop-shadow-none"
                draggable={false}
              />
            </motion.div>
          </section>

          <AnimatePresence>
            {historyOpen && (
              <motion.section
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                transition={screenTransition}
                className="fixed inset-0 z-40 flex flex-col bg-stone-950/90 text-stone-100 shadow-none backdrop-blur-xl"
              >
                <header className="flex items-center justify-between border-b border-white/10 px-4 py-4">
                  <div className="flex min-w-0 items-center gap-2">
                    {historyView === 'messages' ? (
                      <button
                        onClick={() => setHistoryView('sessions')}
                        className="rounded-lg p-2 text-stone-300 transition-colors hover:bg-white/10 hover:text-white"
                        aria-label="返回历史对话列表"
                        title="返回历史对话列表"
                      >
                        <ArrowLeft className="h-5 w-5" />
                      </button>
                    ) : (
                      <div className="h-9 w-9" />
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-serif text-lg text-stone-50">
                        {historyView === 'messages' ? activeSession?.title || '当前对话' : '历史对话'}
                      </div>
                      <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-stone-400">
                        {historyView === 'messages' ? 'Current History' : 'Conversation List'}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setHistoryOpen(false)}
                    className="rounded-lg p-2 text-stone-300 transition-colors hover:bg-white/10 hover:text-white"
                    aria-label="关闭历史"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
                  {historyView === 'sessions' ? (
                    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-2 py-2">
                      {sessions.map((session) => (
                        <button
                          key={session.id}
                          onClick={() => {
                            setActiveSessionId(session.id);
                            setHistoryView('messages');
                          }}
                          className={cn(
                            "w-full rounded-xl border px-4 py-3 text-left transition-colors",
                            session.id === activeSessionId
                              ? "border-orange-400/50 bg-orange-500/15 text-stone-50"
                              : "border-white/10 bg-white/5 text-stone-300 hover:border-white/20 hover:bg-white/10 hover:text-white"
                          )}
                        >
                          <div className="truncate text-sm">{session.title}</div>
                          <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-stone-500">{session.date}</div>
                        </button>
                      ))}
                      {sessions.length === 0 && (
                        <div className="flex h-[50vh] items-center justify-center text-center text-sm text-stone-400">
                          还没有历史对话
                        </div>
                      )}
                    </div>
                  ) : activeSession?.messages.length ? (
                    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-3 py-2">
                      {activeSession.messages.map((message) => (
                        <article
                          key={message.id}
                          className={cn(
                            "min-w-0 rounded-2xl border px-4 py-3 [overflow-wrap:anywhere]",
                            message.role === 'user'
                              ? "ml-8 border-orange-400/25 bg-orange-500/10"
                              : "mr-8 border-white/10 bg-white/7"
                          )}
                        >
                          <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-stone-400">
                            <span>{message.role === 'user' ? 'You' : 'Aeterna'}</span>
                            <span className="text-stone-600">{message.timestamp}</span>
                          </div>
                          {message.images && message.images.length > 0 && (
                            <div className="mb-3 flex flex-wrap gap-2">
                              {message.images.map((image, index) => (
                                <img
                                  key={`${message.id}-${index}`}
                                  src={resolveOpencodeUrl(image)}
                                  alt="历史图片"
                                  onClick={() => setPreviewImage({ src: resolveOpencodeUrl(image), alt: '历史图片' })}
                                  className="max-h-28 max-w-full cursor-pointer rounded-lg border border-white/10 object-contain transition-opacity hover:opacity-85"
                                />
                              ))}
                            </div>
                          )}
                          {message.thinking && (
                            <details className="mb-3 rounded-xl border border-sky-300/15 bg-sky-400/10 px-3 py-2">
                              <summary className="cursor-pointer select-none text-[10px] uppercase tracking-[0.14em] text-sky-200/80">
                                思考
                              </summary>
                              <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-stone-300 [overflow-wrap:anywhere]">
                                {message.thinking}
                              </div>
                            </details>
                          )}
                          {message.toolCalls && message.toolCalls.length > 0 && (
                            <div className="mb-3 grid gap-2">
                              {message.toolCalls.map((tool) => (
                                <details key={tool.id} className="rounded-xl border border-emerald-300/15 bg-emerald-400/10 px-3 py-2">
                                  <summary className="cursor-pointer select-none text-[10px] uppercase tracking-[0.14em] text-emerald-200/80">
                                    工具: {tool.name}{tool.status ? ` · ${tool.status}` : ''}{tool.duration ? ` · ${tool.duration}ms` : ''}
                                  </summary>
                                  <div className="mt-2 grid gap-2">
                                    <div>
                                      <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-stone-500">输入</div>
                                      <pre className="whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-stone-300 [overflow-wrap:anywhere]">{tool.input}</pre>
                                    </div>
                                    {tool.output && (
                                      <div>
                                        <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-stone-500">输出</div>
                                        <pre className="whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-stone-300 [overflow-wrap:anywhere]">{tool.output}</pre>
                                      </div>
                                    )}
                                    {tool.error && (
                                      <div>
                                        <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-red-300/80">错误</div>
                                        <pre className="whitespace-pre-wrap rounded-lg border border-red-400/20 bg-red-950/30 p-2 text-xs text-red-200 [overflow-wrap:anywhere]">{tool.error}</pre>
                                      </div>
                                    )}
                                  </div>
                                </details>
                              ))}
                            </div>
                          )}
                          {message.content && (
                            <div className="whitespace-pre-wrap text-sm leading-relaxed text-stone-100 [overflow-wrap:anywhere]">
                              {message.content}
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center text-center text-sm text-stone-400">
                      当前对话还没有历史消息
                    </div>
                  )}
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 1 }}
            transition={{ ...screenTransition, delay: 0.14 }}
            className="fixed inset-x-0 bottom-[2.5vh] z-20 px-[4vw]"
          >
            <div className="mx-auto w-full max-w-[min(88vw,760px)]">
              <ChatInput
                onSend={handleSendMessage}
                disabled={isThinking}
                overlay
                onHistory={() => {
                  setHistoryView('messages');
                  setHistoryOpen(true);
                }}
                onStartWindowDrag={startDesktopWindowDrag}
                outputActive={isThinking}
                outputContent={activeReplyMessage?.content ?? ''}
                outputThinking={activeReplyMessage?.thinking}
                outputTools={activeReplyMessage?.toolCalls}
                dialogSegments={dialogSegments}
                onPreviewImage={(src, alt) => setPreviewImage({ src, alt: alt ?? '图片预览' })}
              />
            </div>
          </motion.div>
        </main>
      </motion.div>
      ) : (
    <motion.div
      key="chat-with-character"
      {...fullScreenMotion}
      transition={screenTransition}
      className="flex h-[100vh] w-[100vw] bg-bg text-text font-sans overflow-hidden"
    >
      <Sidebar
        sessions={sessions}
        activeId={activeSessionId}
        onSelect={(id) => {
          setActiveSessionId(id);
          setSidebarOpen(false);
        }}
        onNew={handleNewSession}
        isOpen={sidebarOpen}
        setIsOpen={setSidebarOpen}
        theme={theme}
        toggleTheme={toggleTheme}
      />

      <main className="flex h-[100vh] min-w-0 flex-1 flex-col relative">
        
        <header className="flex items-center justify-between px-[2vw] py-[2vh] border-b border-border bg-bg/80 backdrop-blur-md z-10 sticky top-0">
          <div className="min-w-0 font-serif text-lg text-text flex items-center gap-3">
             <button
              onClick={() => setSidebarOpen(true)}
              className="mr-1 rounded-md p-2 text-text-muted transition-colors hover:bg-card hover:text-text"
              aria-label="打开会话抽屉"
            >
              <Menu className="h-5 w-5" />
            </button>
             <MessageSquare className="w-4 h-4 text-accent" />
             <span className="truncate">{activeSession?.title || '新会话'}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleNewSession}
              className="hidden rounded-full border border-border bg-card px-3 py-2 text-[10px] uppercase tracking-[0.15em] text-text-muted shadow-sm transition-colors hover:border-accent/40 hover:text-accent sm:inline-flex"
            >
              新会话
            </button>
          </div>
        </header>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto scroll-smooth">
          <div className="mx-auto w-full max-w-[min(62vw,720px)] px-[2vw]">
            {connectionError ? (
              <div className="h-full min-h-[50vh] flex flex-col items-center justify-center text-center">
                <div className="mb-3 rounded-full border border-border bg-card px-4 py-2 text-[10px] uppercase tracking-[0.15em] text-accent shadow-sm">
                  Backend Offline
                </div>
                <p className="max-w-md text-sm leading-relaxed text-text-muted">
                  无法连接 opencode server：{connectionError}
                </p>
              </div>
            ) : activeSession?.messages.length === 0 ? (
              <div className="h-full min-h-[50vh] flex flex-col items-center justify-center text-center text-text-muted">
                <div className="w-16 h-16 bg-card border border-border text-accent rounded-2xl flex items-center justify-center mb-6 shadow-sm">
                  <span className="text-3xl font-serif">O</span>
                </div>
                <h2 className="text-2xl font-serif text-text mb-2">How can I help you?</h2>
                <p className="text-text-muted max-w-sm text-[14px]">
                  You can ask me questions about architecture, request UI analysis from screenshots, or build tools.
                </p>
              </div>
            ) : (
              <div className="py-6 min-h-full">
                {activeSession?.messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    onPreviewImage={(src, alt) => setPreviewImage({ src, alt: alt ?? '图片预览' })}
                  />
                ))}
                {isThinking && (
                  <div className="flex gap-4 w-full px-4 py-6 md:px-0 opacity-70">
                    <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded border border-accent bg-card text-accent text-sm overflow-hidden">
                      O
                    </div>
                    <div className="flex items-center">
                       <span className="text-sm font-serif text-text-muted animate-pulse">苏岚正在思考...</span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} className="h-10" />
              </div>
            )}
          </div>
        </div>

        {/* Input Area */}
        <div className="px-[2vw]">
          <div className="mx-auto w-full max-w-[min(62vw,720px)]">
            <ChatInput onSend={handleSendMessage} disabled={isThinking} />
          </div>
        </div>
        
      </main>

      {/* Right Column (Character Profile for Desktop) */}
      <CharacterPanel isThinking={isThinking} />
    </motion.div>
      )}
    </AnimatePresence>
    <AnimatePresence>
      {previewImage && (
        <motion.div
          key="image-preview"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={screenTransition}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/86 p-[4vw] backdrop-blur-lg"
          onClick={() => setPreviewImage(undefined)}
        >
          <button
            onClick={() => setPreviewImage(undefined)}
            className="absolute right-4 top-4 rounded-full border border-white/15 bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
            aria-label="关闭图片预览"
          >
            <X className="h-5 w-5" />
          </button>
          <motion.img
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={screenTransition}
            src={previewImage.src}
            alt={previewImage.alt}
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            draggable={false}
          />
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}
