import { useState, useRef, useEffect } from 'react';
import { Menu, MessageSquare, User } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Sidebar } from './components/Sidebar';
import { MessageBubble } from './components/MessageBubble';
import { ChatInput } from './components/ChatInput';
import { CharacterPanel } from './components/CharacterPanel';
import { Session, MessageData } from './types';
import { resizeDesktopWindow } from './lib/desktop-window';
import {
  createSession,
  listMessages,
  listSessions,
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
  const [connectionError, setConnectionError] = useState<string | undefined>();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  const activeSession = sessions.find(s => s.id === activeSessionId);
  
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages, isThinking]);

  useEffect(() => {
    void resizeDesktopWindow('chatWithCharacter');
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

  const switchCharacterMode = (enabled: boolean) => {
    setCharacterMode(enabled);
    window.setTimeout(() => {
      void resizeDesktopWindow(enabled ? 'character' : 'chatWithCharacter');
    }, 220);
  };

  return (
    <AnimatePresence mode="wait" initial={false}>
      {characterMode ? (
      <motion.div
        key="character"
        {...characterScreenMotion}
        transition={screenTransition}
        className="h-[100vh] w-[100vw] bg-bg text-text font-sans overflow-hidden"
      >
        <main className="relative mx-auto flex h-[100vh] w-[100vw] flex-col px-[4vw]">
          <motion.div
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.32, ease: 'easeOut' }}
            className="pointer-events-none absolute inset-x-0 top-0 h-[18vh] bg-gradient-to-b from-card/70 to-transparent"
          />

          <motion.header
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ ...screenTransition, delay: 0.04 }}
            className="relative z-10 flex items-center justify-between py-[2.5vh]"
          >
            <button
              onClick={() => switchCharacterMode(false)}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-xs uppercase tracking-[0.15em] text-text-muted shadow-sm transition-colors hover:border-accent/40 hover:text-accent"
            >
              <MessageSquare className="h-4 w-4" />
              三栏模式
            </button>
            <div />
          </motion.header>

          <section className="flex flex-1 flex-col items-center justify-center pb-[20vh] pt-[2vh] text-center">
            <motion.div
              initial={{ opacity: 0, y: 28, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 1 }}
              transition={{ ...screenTransition, delay: 0.08 }}
              className="relative mb-[4vh] aspect-[9/16] h-[min(82vh,calc(88vw*16/9))] max-h-[82vh] overflow-hidden"
            >
              <img
                src={isThinking ? '/characters/sulan/04_thinking_chin_transparent.png' : '/characters/sulan/01_default_stand_transparent.png'}
                alt="苏岚"
                className="absolute bottom-0 left-1/2 h-[104%] w-auto max-w-none -translate-x-1/2 object-contain object-bottom"
                draggable={false}
              />
            </motion.div>
          </section>

          <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 1 }}
            transition={{ ...screenTransition, delay: 0.14 }}
            className="fixed inset-x-0 bottom-0 z-20 px-[4vw]"
          >
            <div className="mx-auto w-full max-w-[min(88vw,760px)]">
              <ChatInput onSend={handleSendMessage} disabled={isThinking} />
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
            <button
              onClick={() => switchCharacterMode(true)}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-[10px] uppercase tracking-[0.15em] text-text-muted shadow-sm transition-colors hover:border-accent/40 hover:text-accent"
            >
              <User className="h-4 w-4" />
              角色模式
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
                  <MessageBubble key={msg.id} message={msg} />
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
  );
}
