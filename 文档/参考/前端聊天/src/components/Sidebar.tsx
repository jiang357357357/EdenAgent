import { Plus, MessageSquare, Menu, Moon, Sun, Settings } from 'lucide-react';
import { cn } from '../lib/utils';
import { Session } from '../types';

interface SidebarProps {
  sessions: Session[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
}

export function Sidebar({ 
  sessions, 
  activeId, 
  onSelect, 
  onNew, 
  isOpen, 
  setIsOpen,
  theme,
  toggleTheme
}: SidebarProps) {
  
  // Group sessions by date
  // For this mock, we'll just show them all in a single group, but structure supports grouping
  
  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-30 md:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar Drawer */}
      <aside className={cn(
        "fixed md:static inset-y-0 left-0 z-40 w-[240px] bg-bg border-r border-border flex flex-col transform transition-transform duration-300 ease-in-out md:translate-x-0",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        
        {/* Header / New Chat */}
        <div className="p-6 flex items-center justify-between">
            <div className="text-xl flex items-center gap-3 text-text font-serif tracking-[0.1em]">
                <span className="w-8 h-8 bg-card border border-accent rounded flex items-center justify-center text-accent text-sm">O</span>
                AETERNA
            </div>
          <button 
            onClick={() => setIsOpen(false)}
            className="lg:hidden p-2 text-text-muted hover:bg-card rounded-md"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
        
        <div className="px-6 pb-6 border-b border-border mb-4">
          <button 
            onClick={onNew}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 border border-accent-dim text-accent hover:border-accent hover:bg-accent/5 transition-colors rounded-full font-sans text-xs uppercase tracking-[0.15em] shadow-sm"
          >
            <Plus className="w-4 h-4" />
            New Chat
          </button>
        </div>

        {/* Session List */}
        <div className="flex-1 overflow-y-auto px-6 space-y-6 py-2">
           <div>
              <span className="block text-[10px] uppercase tracking-[0.2em] text-text-muted mb-4">Archive</span>
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

        {/* Footer / Settings */}
        <div className="p-6 border-t border-border flex items-center justify-between text-[11px] text-text-muted uppercase tracking-[0.1em]">
          <div>&copy; 2024 AETERNA</div>
        </div>
      </aside>
    </>
  );
}
