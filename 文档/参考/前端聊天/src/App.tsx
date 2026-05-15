import { useState, useRef, useEffect } from 'react';
import { Menu, MessageSquare, User } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { MessageBubble } from './components/MessageBubble';
import { ChatInput } from './components/ChatInput';
import { CharacterPanel } from './components/CharacterPanel';
import { Session, MessageData } from './types';
import { cn } from './lib/utils';

// Mock Data
const MOCK_SESSIONS: Session[] = [
  {
    id: '1',
    title: '分析前端架构',
    date: 'today',
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: '帮我看一下这张截图里的前端界面风格，它使用了什么色系？结构是怎样的？',
        timestamp: '上午 10:23',
        images: ['https://storage.googleapis.com/gweb-uniblog-publish-prod/original_images/Gemini_1.5_Pro_1.png']
      },
      {
        id: 'm2',
        role: 'assistant',
        content: '根据截图，这是一个**现代化、轻量级**的 AI 聊天界面。主要的色系和结构如下：\n\n### 整体风格\n- 采用了类似 iMessage/微信 的**气泡对话**形式。\n- 结合了 IDE 的技术感，展示具体的**工具调用过程**和**思考逻辑**。\n\n### 布局分析\n1. **左侧固定或可隐藏栏**：通常用于会话列表管理。背景色较浅或与主背景形成细微对比。\n2. **主聊天区**：一问一答纵向排列。\n   - 用户的消息气泡在右侧流式呈现。\n   - 助手回复在左侧展开。\n3. **底部输入框**：支持多行展开、附件和快捷发送。',
        timestamp: '上午 10:24',
        thinking: '1. 分析用户的意图：用户想要分析某张（假设传入）的前端界面设计风格和结构。\n2. 观察图片：可以看到轻量的阴影，细致的边框，以及蓝白为主的明亮配色。采用了经典的双栏结构，右侧是主聊天窗口。有很多细节如“思考过程”折叠框、“工具卡片”折叠框。\n3. 提取关键点并分类：色系、布局（侧边栏、主区域、底部输入框），以及特色组件（思维链展示、工具卡片）。\n4. 生成结构化回复。',
        toolCalls: [
          {
            id: 't1',
            name: 'vision',
            status: 'success',
            input: '{"image_url": "screenshot.png", "prompt": "Describe layout."}',
            output: '{"layout": "Two-column", "colors": ["white", "light-gray", "blue"]}',
            duration: 4120
          }
        ]
      },
      {
        id: 'm3',
        role: 'user',
        content: '明白了，我希望能用 React 和 Tailwind 自己实现一套这样的组件。你能给一个工具卡片 (ToolCard) 的基础代码吗？要可以折叠的。',
        timestamp: '上午 10:26'
      },
      {
        id: 'm4',
        role: 'assistant',
        content: '当然可以！这是使用 `React` 和 `Tailwind CSS` 实现的一个可折叠工具卡片组件的示例。我使用了 `lucide-react` 来显示图标。\n\n```tsx\nimport { useState } from "react";\nimport { ChevronRight, ChevronDown, Wrench } from "lucide-react";\n\nexport function ToolCard({ toolName, duration }) {\n  const [expanded, setExpanded] = useState(false);\n\n  return (\n    <div className="border rounded-xl text-sm overflow-hidden">\n      <button \n        onClick={() => setExpanded(!expanded)}\n        className="w-full p-3 flex justify-between items-center bg-gray-50 hover:bg-gray-100 transition-colors"\n      >\n        <span className="flex items-center gap-2 font-medium">\n          <Wrench className="w-4 h-4 text-blue-500" />\n          {toolName} ({duration}ms)\n        </span>\n        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}\n      </button>\n      \n      {expanded && (\n        <div className="p-3 bg-white border-t">\n           <pre className="text-gray-600">{"// Tool execution details here..."}</pre>\n        </div>\n      )}\n    </div>\n  );\n}\n```\n你可以根据需要加入 Framer Motion 来实现更平滑的折叠动画！',
        timestamp: '上午 10:26',
        thinking: '用户请求一个 React + Tailwind 的工具卡片代码示例。要求可以折叠。我将使用基础的 React useState 来控制展开状态。提供一个精简版的代码作为参考。'
      }
    ]
  },
  {
    id: '2',
    title: '系统工具集配置优化',
    date: 'yesterday',
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: '如何优化 shell exec 的并发执行策略？',
        timestamp: '昨天下午 14:10'
      }
    ]
  }
];

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessions, setSessions] = useState<Session[]>(MOCK_SESSIONS);
  const [activeSessionId, setActiveSessionId] = useState<string>(MOCK_SESSIONS[0].id);
  const [isThinking, setIsThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  const activeSession = sessions.find(s => s.id === activeSessionId);
  
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages, isThinking]);

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

  const handleSendMessage = (content: string, images: string[]) => {
    const newMessage: MessageData = {
      id: Date.now().toString(),
      role: 'user',
      content,
      images: images.length > 0 ? images : undefined,
      timestamp: '刚刚',
    };

    setSessions(prev => prev.map(s => {
      if (s.id === activeSessionId) {
        return { ...s, messages: [...s.messages, newMessage] };
      }
      return s;
    }));

    setIsThinking(true);

    // Mock AI response
    setTimeout(() => {
      setIsThinking(false);
      const aiResponse: MessageData = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '这是一个模拟的回复。在真实环境中，这里会接入大模型的响应流。',
        timestamp: '刚刚',
        thinking: '收到新消息。由于没有接入真实 API，我将返回一条预设的占位文本。',
        toolCalls: [
          {
            id: 't-mock',
            name: 'mock_query',
            status: 'success',
            input: '{"query": "Hello world"}',
            output: '{"status": "ok"}',
            duration: 120
          }
        ]
      };
      
      setSessions(prev => prev.map(s => {
        if (s.id === activeSessionId) {
          return { ...s, messages: [...s.messages, aiResponse] };
        }
        return s;
      }));
    }, 1500);
  };

  const handleNewSession = () => {
    const newSession: Session = {
      id: Date.now().toString(),
      title: '新会话',
      date: 'today',
      messages: []
    };
    setSessions([newSession, ...sessions]);
    setActiveSessionId(newSession.id);
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  return (
    <div className="flex h-screen bg-bg text-text font-sans overflow-hidden">
      
      {/* Sidebar */}
      <Sidebar 
        sessions={sessions}
        activeId={activeSessionId}
        onSelect={(id) => {
          setActiveSessionId(id);
          if (window.innerWidth < 768) setSidebarOpen(false);
        }}
        onNew={handleNewSession}
        isOpen={sidebarOpen}
        setIsOpen={setSidebarOpen}
        theme={theme}
        toggleTheme={toggleTheme}
      />

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative min-w-0">
        
        {/* Mobile Header (Character Mode) */}
        <header className="md:hidden flex flex-col items-center pt-6 pb-4 border-b border-border bg-bg/90 backdrop-blur-md z-10 sticky top-0 relative">
          <button 
            onClick={() => setSidebarOpen(true)}
            className="absolute top-4 left-4 p-2 text-text-muted hover:text-text hover:bg-card rounded-md transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          
          <div className="w-16 h-20 rounded-xl border border-border shadow-sm overflow-hidden mb-3 bg-card flex items-center justify-center">
            <User className="w-6 h-6 text-text-muted/30" />
          </div>
          <h2 className="text-xl font-serif font-semibold text-text">苏岚</h2>
          <p className="text-[10px] text-text-muted mt-1 uppercase tracking-widest">19 yrs · Genius Dev</p>
        </header>

        {/* Desktop Header */}
        <header className="hidden md:flex items-center justify-between p-4 px-6 border-b border-border bg-bg/80 backdrop-blur-md z-10 sticky top-0">
          <div className="font-serif text-lg text-text flex items-center gap-3">
             <MessageSquare className="w-4 h-4 text-accent" />
             {activeSession?.title || '新会话'}
          </div>
        </header>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto scroll-smooth">
          <div className="max-w-4xl mx-auto px-4 w-full">
            {activeSession?.messages.length === 0 ? (
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
        <div className="px-4">
          <div className="max-w-4xl mx-auto w-full">
            <ChatInput onSend={handleSendMessage} disabled={isThinking} />
          </div>
        </div>
        
      </main>

      {/* Right Column (Character Profile for Desktop) */}
      <CharacterPanel isThinking={isThinking} />
    </div>
  );
}
