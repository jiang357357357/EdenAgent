import { Plus, Menu, LogOut, Sparkles } from 'lucide-react';
import { cn } from '../lib/utils';
import { Session } from '../types';
import type { AuthUser } from '../lib/auth';

interface SidebarProps {
  sessions: Session[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  currentUser?: AuthUser | null;
  onSelfAwake: () => void;
  onLogout: () => void;
}

export function Sidebar({ 
  sessions, 
  activeId, 
  onSelect, 
  onNew, 
  isOpen, 
  setIsOpen,
  currentUser,
  onSelfAwake,
  onLogout,
}: SidebarProps) {
  
  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/40 z-30 backdrop-blur-sm transition-opacity"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar Drawer */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-40 flex w-[28vw] transform flex-col border-r border-border bg-bg shadow-2xl transition-transform duration-300 ease-in-out",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        
        {/* Header / New Chat */}
        <div className="flex items-center justify-between px-[2vw] py-[3.2vh]">
            <div className="flex items-center gap-[1.2vw] font-serif text-[3.2vh] tracking-[0.1em] text-text">
                <span className="flex h-[7.5vh] w-[4.2vw] items-center justify-center rounded-[0.8vh] border border-accent bg-card text-[2.2vh] text-accent">M</span>
                MonAgent
            </div>
          <div className="flex items-center gap-[0.45vw]">
            <button
              onClick={onNew}
              className="rounded-[0.9vh] p-[1.25vh] text-accent transition-colors hover:bg-card"
              aria-label="新会话"
              title="新会话"
            >
              <Plus className="h-[3vh] w-[3vh]" />
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="rounded-[0.9vh] p-[1.25vh] text-text-muted transition-colors hover:bg-card"
              aria-label="收起侧栏"
              title="收起侧栏"
            >
              <Menu className="h-[3vh] w-[3vh]" />
            </button>
          </div>
        </div>
        
        {/* Session List */}
        <div className="flex-1 space-y-[3vh] overflow-y-auto px-[2vw] py-[1vh]">
           <div>
              <span className="mb-[2vh] block text-[1.55vh] uppercase tracking-[0.2em] text-text-muted">会话记录</span>
              <ul className="space-y-[0.8vh]">
                {sessions.map(session => (
                    <li key={session.id}>
                        <button
                          onClick={() => onSelect(session.id)}
                          className={cn(
                              "flex w-full items-center gap-[1vw] truncate rounded-[0.8vh] px-[1vw] py-[1.8vh] text-left text-[2.25vh] transition-colors",
                              activeId === session.id 
                                ? "bg-card text-text border border-transparent border-l-accent" 
                                : "text-text-muted hover:bg-card hover:text-text border border-transparent border-l-transparent"
                          )}
                        >
                            <span className="truncate">{session.title}</span>
                        </button>
                    </li>
                ))}
              </ul>
           </div>
        </div>

        <div className="border-t border-border px-[2vw] py-[2.2vh]">
          <div className="mb-[2vh] min-w-0">
            <div className="truncate text-[2.2vh] text-text">{currentUser?.username ?? '未登录'}</div>
            <div className="text-[1.45vh] uppercase tracking-[0.16em] text-text-muted">
              {currentUser?.is_superuser ? 'Core Admin' : currentUser?.is_staff ? 'Core Staff' : 'Core User'}
            </div>
          </div>
          <button
            onClick={onSelfAwake}
            className="mb-[1.5vh] flex w-full items-center justify-center gap-[0.8vw] rounded-full border border-border bg-card px-[1vw] py-[1.65vh] text-[1.85vh] uppercase tracking-[0.15em] text-text-muted transition-colors hover:border-accent/40 hover:text-accent"
          >
            <Sparkles className="h-[2.5vh] w-[2.5vh]" />
            自醒
          </button>
          <button
            onClick={onLogout}
            className="flex w-full items-center justify-center gap-[0.8vw] rounded-full border border-border bg-card px-[1vw] py-[1.65vh] text-[1.85vh] uppercase tracking-[0.15em] text-text-muted transition-colors hover:border-accent/40 hover:text-accent"
          >
            <LogOut className="h-[2.5vh] w-[2.5vh]" />
            退出登录
          </button>
        </div>

      </aside>
    </>
  );
}
