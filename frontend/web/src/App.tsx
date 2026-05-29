import { useState, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { ChatPage } from './pages/chat';
import { CharacterPage } from './pages/character';
import { LoginPage } from './pages/login';
import { clearAuth, getAuthMode, getErrorMessage, getStoredToken, getStoredUser, getDevAccount, loginWithCore, logoutWithCore, verifyTokenWithCore, type DevAccount } from './lib/auth';
import { Session, MessageData, PendingPermission, PendingQuestion } from './types';
import { listenDesktopViewMode, resizeDesktopWindow, setDesktopViewModeState, setDesktopWindowAppearance, startDesktopWindowDrag } from './lib/desktop-window';
import {
  createSession,
  listPermissionsRaw,
  listQuestionsRaw,
  listMessages,
  listSessions,
  rejectQuestion,
  replyPermission,
  replyQuestion,
  resolveOpencodeUrl,
  sendPrompt,
  subscribeEvents,
} from './lib/opencode';

const screenTransition = {
  duration: 0.28,
  ease: [0.16, 1, 0.3, 1],
} as const;

export default function App() {
  const [authStatus, setAuthStatus] = useState<'checking' | 'authenticated' | 'unauthenticated'>('checking');
  const [authError, setAuthError] = useState<string | undefined>();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [currentUser, setCurrentUser] = useState(() => getStoredUser());
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
  const [pendingPermissions, setPendingPermissions] = useState<PendingPermission[]>([]);
  const [pendingQuestions, setPendingQuestions] = useState<PendingQuestion[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const reportAuthError = (stage: string, error: unknown, fallback: string) => {
    const message = getErrorMessage(error, fallback);
    console.error(`[Auth] ${stage} failed`, error);
    return message;
  };

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
  const activePendingPermissions = pendingPermissions.filter((request) => !activeSessionId || request.sessionID === activeSessionId);
  const activePendingQuestions = pendingQuestions.filter((request) => !activeSessionId || request.sessionID === activeSessionId);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapAuth() {
      const mode = getAuthMode()
      console.log('[bootstrapAuth] authMode:', mode)

      if (mode === 'production') {
        console.log('[bootstrapAuth] production mode, clearing auth')
        clearAuth();
        setCurrentUser(null);
        setAuthError(undefined);
        setAuthStatus('unauthenticated');
        return;
      }

      const token = getStoredToken();
      console.log('[bootstrapAuth] stored token:', token ? 'exists' : 'none')

      if (token) {
        try {
          console.log('[bootstrapAuth] verifying token...')
          const response = await verifyTokenWithCore(token);
          if (cancelled) return;
          console.log('[bootstrapAuth] token valid, user:', response.user.username)
          setCurrentUser(response.user);
          setAuthError(undefined);
          setAuthStatus('authenticated');
          return;
        } catch (error) {
          console.log('[bootstrapAuth] token invalid:', error)
          if (cancelled) return;
          clearAuth();
          setCurrentUser(null);
          if (cancelled) return;
          setAuthError(reportAuthError('verify-token', error, '登录已失效。'));
        }
      }

      console.log('[bootstrapAuth] trying dev account login...')
      let devAccount: DevAccount | null = null
      try {
        devAccount = await getDevAccount();
        console.log('[bootstrapAuth] getDevAccount result:', devAccount)
      } catch (error) {
        console.error('[bootstrapAuth] getDevAccount error:', error)
      }

      if (devAccount && !cancelled) {
        try {
          console.log('[bootstrapAuth] logging in with dev account:', devAccount.username)
          const response = await loginWithCore(devAccount.username, devAccount.password);
          if (cancelled) return;
          console.log('[bootstrapAuth] dev login success, user:', response.user.username)
          setCurrentUser(response.user);
          setAuthError(undefined);
          setAuthStatus('authenticated');
          return;
        } catch (error) {
          console.error('[bootstrapAuth] dev login failed:', error)
        }
      }

      console.log('[bootstrapAuth] no dev account, showing LoginPage')
      if (!cancelled) setAuthStatus('unauthenticated');
    }

    void bootstrapAuth();
    return () => {
      cancelled = true;
    };
  }, []);
  
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages, isThinking]);

  useEffect(() => {
    void resizeDesktopWindow('chatWithCharacter');
    if (authStatus !== 'authenticated') return;
    void setDesktopWindowAppearance('chatWithCharacter');
  }, [authStatus]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
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
  }, [authStatus]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    let cancelled = false;

    async function load() {
      try {
        const [loaded, permissions, questions] = await Promise.all([
          listSessions(),
          listPermissionsRaw(),
          listQuestionsRaw(),
        ]);
        if (cancelled) return;
        setConnectionError(undefined);
        setSessions(loaded);
        setPendingPermissions(permissions);
        setPendingQuestions(questions);
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
  }, [authStatus]);

  const refreshBlockers = async () => {
    const [permissions, questions] = await Promise.all([listPermissionsRaw(), listQuestionsRaw()]);
    setPendingPermissions(permissions);
    setPendingQuestions(questions);
  };

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
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
  }, [activeSessionId, authStatus]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    let cleanup: (() => void) | undefined;
    let disposed = false;

    void subscribeEvents((event) => {
      const properties = 'properties' in event ? event.properties as { sessionID?: string } : undefined;

      if (
        event.type === 'permission.asked' ||
        event.type === 'permission.replied' ||
        event.type === 'question.asked' ||
        event.type === 'question.replied' ||
        event.type === 'question.rejected'
      ) {
        void refreshBlockers().catch(() => undefined);
      }

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
  }, [activeSessionId, authStatus]);

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

  const handleLogin = async (username: string, password: string) => {
    if (!username || !password) {
      setAuthError('请输入用户名和密码。');
      return;
    }

    setIsAuthenticating(true);
    setAuthError(undefined);

    try {
      const response = await loginWithCore(username, password);
      setCurrentUser(response.user);
      setAuthStatus('authenticated');
      setSessions([]);
      setPendingPermissions([]);
      setPendingQuestions([]);
      setActiveSessionId('');
    } catch (error) {
      setAuthStatus('unauthenticated');
      setAuthError(reportAuthError('login', error, '登录失败'));
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleLogout = async () => {
    setSidebarOpen(false);
    await logoutWithCore(getStoredToken());
    setCurrentUser(null);
    setSessions([]);
    setPendingPermissions([]);
    setPendingQuestions([]);
    setActiveSessionId('');
    setIsThinking(false);
    setConnectionError(undefined);
    setAuthError(undefined);
    setAuthStatus('unauthenticated');
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

  const handlePermissionReply = async (requestID: string, reply: 'once' | 'always' | 'reject', message?: string) => {
    await replyPermission(requestID, reply, message);
    await refreshBlockers();
  };

  const handleQuestionReply = async (requestID: string, answers: string[][]) => {
    await replyQuestion(requestID, answers);
    await refreshBlockers();
  };

  const handleQuestionReject = async (requestID: string) => {
    await rejectQuestion(requestID);
    await refreshBlockers();
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

  if (authStatus === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-text">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
          <p className="text-sm text-text-muted">正在准备登录...</p>
        </div>
      </div>
    );
  }

  if (authStatus !== 'authenticated') {
    return (
      <LoginPage
        onLogin={handleLogin}
        isSubmitting={isAuthenticating}
        error={authError}
      />
    );
  }

  return (
    <>
      <AnimatePresence mode="wait" initial={false}>
        {characterMode ? (
          <CharacterPage
            isThinking={isThinking}
            activeSession={activeSession}
            activeReplyMessage={activeReplyMessage}
            activePendingPermissions={activePendingPermissions}
            activePendingQuestions={activePendingQuestions}
            historyOpen={historyOpen}
            historyView={historyView}
            sessions={sessions}
            activeSessionId={activeSessionId}
            dialogSegments={dialogSegments}
            onSetHistoryOpen={setHistoryOpen}
            onSetHistoryView={setHistoryView}
            onSelectSession={setActiveSessionId}
            onSendMessage={handleSendMessage}
            onPermissionReply={handlePermissionReply}
            onQuestionReply={handleQuestionReply}
            onQuestionReject={handleQuestionReject}
            onStartWindowDrag={startDesktopWindowDrag}
            onPreviewImage={(src, alt) => setPreviewImage({ src, alt: alt ?? '图片预览' })}
          />
        ) : (
          <ChatPage
            sessions={sessions}
            activeSessionId={activeSessionId}
            activeSession={activeSession}
            sidebarOpen={sidebarOpen}
            setSidebarOpen={setSidebarOpen}
            theme={theme}
            toggleTheme={toggleTheme}
            currentUser={currentUser}
            isThinking={isThinking}
            connectionError={connectionError}
            activePendingPermissions={activePendingPermissions}
            activePendingQuestions={activePendingQuestions}
            messagesEndRef={messagesEndRef}
            onSelectSession={setActiveSessionId}
            onNewSession={handleNewSession}
            onSendMessage={handleSendMessage}
            onPermissionReply={handlePermissionReply}
            onQuestionReply={handleQuestionReply}
            onQuestionReject={handleQuestionReject}
            onPreviewImage={(src, alt) => setPreviewImage({ src, alt: alt ?? '图片预览' })}
            onLogout={handleLogout}
          />
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
