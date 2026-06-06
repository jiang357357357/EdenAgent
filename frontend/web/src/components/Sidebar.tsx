import { Plus, Menu, LogOut, Moon, Sun } from 'lucide-react';
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
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  currentUser?: AuthUser | null;
  onLogout: () => void;
}

export function Sidebar({ 
  sessions, 
  activeId, 
  onSelect, 
  onNew, 
  isOpen, 
  setIsOpen,
  theme,
  toggleTheme,
  currentUser,
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
        "fixed inset-y-0 left-0 z-40 w-[min(72vw,260px)] bg-bg border-r border-border flex flex-col transform shadow-2xl transition-transform duration-300 ease-in-out",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        
        {/* Header / New Chat */}
        <div className="px-[2vw] py-[3vh] flex items-center justify-between">
            <div className="text-xl flex items-center gap-3 text-text font-serif tracking-[0.1em]">
                <span className="w-8 h-8 bg-card border border-accent rounded flex items-center justify-center text-accent text-sm">M</span>
                MonAgent
            </div>
          <button 
            onClick={() => setIsOpen(false)}
            className="p-2 text-text-muted hover:bg-card rounded-md"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
        
        <div className="px-[2vw] pb-[3vh] border-b border-border mb-[2vh]">
          <button 
            onClick={onNew}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 border border-accent-dim text-accent hover:border-accent hover:bg-accent/5 transition-colors rounded-full font-sans text-xs uppercase tracking-[0.15em] shadow-sm"
          >
            <Plus className="w-4 h-4" />
            新会话
          </button>
        </div>

        {/* Session List */}
        <div className="flex-1 overflow-y-auto px-[2vw] space-y-[3vh] py-[1vh]">
           <div>
              <span className="block text-[10px] uppercase tracking-[0.2em] text-text-muted mb-4">会话记录</span>
              <ul className="space-y-1">
                {sessions.map(session => (
                    <li key={session.id}>
                        <button
                          onClick={() => onSelect(session.id)}
                          className={cn(
                              "w-full flex items-center gap-3 px-3 py-2.5 rounded  text-left text-sm truncate transition-colors",
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

        <div className="border-t border-border px-[2vw] py-[2vh]">
          <div className="mb-3 min-w-0">
            <div className="truncate text-sm text-text">{currentUser?.username ?? '未登录'}</div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-text-muted">
              {currentUser?.is_superuser ? 'Core Admin' : currentUser?.is_staff ? 'Core Staff' : 'Core User'}
            </div>
          </div>
          <button
            onClick={toggleTheme}
            className="mb-2 flex w-full items-center justify-center gap-2 rounded-full border border-border bg-card px-3 py-2.5 text-xs uppercase tracking-[0.15em] text-text-muted transition-colors hover:border-accent/40 hover:text-accent"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {theme === 'dark' ? '浅色模式' : '深色模式'}
          </button>
          <button
            onClick={onLogout}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-border bg-card px-3 py-2.5 text-xs uppercase tracking-[0.15em] text-text-muted transition-colors hover:border-accent/40 hover:text-accent"
          >
            <LogOut className="h-4 w-4" />
            退出登录
          </button>
        </div>

      </aside>
    </>
  );
}
