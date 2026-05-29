import { Menu, MessageSquare } from 'lucide-react';
import { motion } from 'motion/react';
import { CharacterPanel } from '../../components/CharacterPanel';
import { ChatInput } from '../../components/ChatInput';
import { MessageBubble } from '../../components/MessageBubble';
import { PermissionRequestCard } from '../../components/PermissionRequestCard';
import { QuestionRequestCard } from '../../components/QuestionRequestCard';
import { Sidebar } from '../../components/Sidebar';
import type { AuthUser } from '../../lib/auth';
import type { PendingPermission, PendingQuestion, Session } from '../../types';

const fullScreenMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

const screenTransition = {
  duration: 0.28,
  ease: [0.16, 1, 0.3, 1],
} as const;

interface ChatPageProps {
  sessions: Session[];
  activeSessionId: string;
  activeSession?: Session;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  currentUser?: AuthUser | null;
  isThinking: boolean;
  connectionError?: string;
  activePendingPermissions: PendingPermission[];
  activePendingQuestions: PendingQuestion[];
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onSendMessage: (content: string, images: string[]) => Promise<void>;
  onPermissionReply: (requestID: string, reply: 'once' | 'always' | 'reject', message?: string) => Promise<void>;
  onQuestionReply: (requestID: string, answers: string[][]) => Promise<void>;
  onQuestionReject: (requestID: string) => Promise<void>;
  onPreviewImage: (src: string, alt?: string) => void;
  onLogout: () => Promise<void> | void;
}

export function ChatPage({
  sessions,
  activeSessionId,
  activeSession,
  sidebarOpen,
  setSidebarOpen,
  theme,
  toggleTheme,
  currentUser,
  isThinking,
  connectionError,
  activePendingPermissions,
  activePendingQuestions,
  messagesEndRef,
  onSelectSession,
  onNewSession,
  onSendMessage,
  onPermissionReply,
  onQuestionReply,
  onQuestionReject,
  onPreviewImage,
  onLogout,
}: ChatPageProps) {
  return (
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
          onSelectSession(id);
          setSidebarOpen(false);
        }}
        onNew={onNewSession}
        isOpen={sidebarOpen}
        setIsOpen={setSidebarOpen}
        theme={theme}
        toggleTheme={toggleTheme}
        currentUser={currentUser}
        onLogout={onLogout}
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
              onClick={onNewSession}
              className="hidden rounded-full border border-border bg-card px-3 py-2 text-[10px] uppercase tracking-[0.15em] text-text-muted shadow-sm transition-colors hover:border-accent/40 hover:text-accent sm:inline-flex"
            >
              新会话
            </button>
          </div>
        </header>

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
                    onPreviewImage={(src, alt) => onPreviewImage(src, alt ?? '图片预览')}
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

        <div className="px-[2vw]">
          <div className="mx-auto w-full max-w-[min(62vw,720px)]">
            {(activePendingPermissions.length > 0 || activePendingQuestions.length > 0) && (
              <div className="mb-3 grid gap-3">
                {activePendingPermissions.map((request) => (
                  <PermissionRequestCard key={request.id} request={request} onReply={onPermissionReply} />
                ))}
                {activePendingQuestions.map((request) => (
                  <QuestionRequestCard
                    key={request.id}
                    request={request}
                    onReply={onQuestionReply}
                    onReject={onQuestionReject}
                  />
                ))}
              </div>
            )}
            <ChatInput onSend={onSendMessage} disabled={isThinking} />
          </div>
        </div>
      </main>

      <CharacterPanel isThinking={isThinking} />
    </motion.div>
  );
}
