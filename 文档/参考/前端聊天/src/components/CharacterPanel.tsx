import { User, Circle } from 'lucide-react';
import { cn } from '../lib/utils';

export function CharacterPanel({ isThinking = false }: { isThinking?: boolean }) {
  return (
    <aside className="w-[220px] lg:w-[280px] border-l border-border bg-bg flex flex-col items-center py-6 lg:py-10 px-4 lg:px-6 overflow-y-auto hidden md:flex shrink-0">
      <div className="w-full flex-1 flex flex-col items-center justify-center">
        <div className="w-32 h-48 lg:w-48 lg:h-64 rounded-xl border border-border overflow-hidden mb-6 bg-card flex items-center justify-center shadow-sm relative group">
          <User className="w-16 h-16 text-text-muted/20" />
          {/* Subtle gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-bg/40 to-transparent"></div>
          <div className="absolute bottom-2 right-2 text-[10px] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity uppercase tracking-widest">
            Avatar View
          </div>
        </div>
        
        <h2 className="text-2xl font-serif text-text mb-2">苏岚</h2>
        <p className="text-text-muted text-sm mb-8 text-center px-4 leading-relaxed">
          19岁 · 天才开发者<br/>
          <span className="text-[12px] opacity-70">Focuses on Algorithms & Architecture. Runs on Milk Tea.</span>
        </p>
        
        <div className="flex items-center gap-2 text-[10px] font-sans uppercase tracking-[0.15em] px-4 py-2 rounded-full border border-border bg-card shadow-sm transition-all duration-300">
          <Circle className={cn("w-2 h-2 fill-current", isThinking ? "text-accent animate-pulse" : "text-emerald-500")} />
          {isThinking ? "Thinking..." : "Online"}
        </div>
      </div>
      
      <div className="w-full mt-auto pt-8 border-t border-border flex justify-between text-[10px] uppercase tracking-widest text-text-muted">
        <span>Status</span>
        <span>Operational</span>
      </div>
    </aside>
  );
}
