import { useState } from 'react';
import { Bot, KeyRound, Loader, LockKeyhole, UserRound } from 'lucide-react';
import { motion } from 'motion/react';

interface LoginPageProps {
  onLogin: (username: string, password: string) => Promise<void>;
  isSubmitting?: boolean;
  error?: string;
}

export function LoginPage({ onLogin, isSubmitting = false, error }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onLogin(username.trim(), password);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="relative flex h-[100vh] w-[100vw] items-center justify-center overflow-hidden bg-[linear-gradient(135deg,#f7f5f1_0%,#f2eee7_48%,#eef3f0_100%)] p-[3.2vh] text-text"
    >
      <div className="pointer-events-none fixed inset-0 opacity-[0.38] [background-image:linear-gradient(rgba(120,113,108,0.13)_1px,transparent_1px),linear-gradient(90deg,rgba(120,113,108,0.1)_1px,transparent_1px)] [background-size:3vw_3vw]" />

      <main className="relative grid h-[82vh] w-[88vw] grid-cols-[0.92fr_1.08fr] overflow-hidden rounded-[3vh] border border-white/80 bg-white/78 shadow-[0_3vh_8vh_rgba(41,37,36,0.12)] backdrop-blur">
        <section className="relative flex h-full flex-col justify-between overflow-hidden border-r border-border/70 bg-card/58 px-[3vw] py-[5vh]">
          <div className="absolute inset-x-0 top-0 h-[0.55vh] bg-accent" />
          <div className="absolute right-[-4vw] top-[7vh] h-[22vh] w-[22vh] rounded-full border border-accent/10" />

          <div className="relative">
            <div className="mb-[6vh] flex items-center gap-[1.1vw]">
              <div className="flex h-[7.2vh] w-[7.2vh] items-center justify-center rounded-[1.7vh] border border-accent/25 bg-accent/10 text-accent shadow-sm">
                <Bot className="h-[3.4vh] w-[3.4vh]" />
              </div>
              <div className="min-w-0">
                <div className="font-serif text-[5vh] leading-none text-text">MonAgent</div>
                <div className="mt-[1vh] text-[1.9vh] tracking-[0.18em] text-text-muted">本地智能体工作台</div>
              </div>
            </div>

            <div className="rounded-[2.2vh] border border-border/85 bg-bg/62 p-[3vh] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
              <div className="mb-[2.2vh] text-[1.75vh] tracking-[0.16em] text-text-muted">AGENT ACCESS</div>
              <h1 className="font-serif text-[5.2vh] leading-tight text-text">进入工作台</h1>
              <p className="mt-[2vh] text-[2.25vh] leading-[1.55] text-text-muted">
                使用 Core 用户身份进入本地 Agent，保持会话、工具与角色配置同步。
              </p>
            </div>
          </div>

          <div className="relative grid grid-cols-3 gap-[1vw] text-[1.85vh] text-text-muted">
            {['Core', 'Agent', 'Local'].map((item) => (
              <div key={item} className="rounded-[1.7vh] border border-border/80 bg-card/70 px-[1vw] py-[1.6vh]">
                <div className="mb-[1vh] h-[0.5vh] w-[3.2vw] rounded-full bg-accent" />
                {item}
              </div>
            ))}
          </div>
        </section>

        <section className="flex h-full items-center px-[4vw] py-[5vh]">
          <div className="w-full">
            <div className="mb-[4vh]">
              <div className="mb-[2vh] flex h-[7vh] w-[7vh] items-center justify-center rounded-[1.7vh] border border-accent/20 bg-accent/10 text-accent">
                <KeyRound className="h-[3.1vh] w-[3.1vh]" />
              </div>
              <h2 className="font-serif text-[5.2vh] leading-none text-text">身份验证</h2>
              <p className="mt-[1.6vh] text-[2.25vh] text-text-muted">进入 MonAgent 工作台</p>
            </div>

            <form className="space-y-[2.5vh]" onSubmit={handleSubmit}>
              <label className="block">
                <span className="mb-[1vh] block text-[2.1vh] text-text-muted">用户名</span>
                <div className="flex h-[8.5vh] items-center gap-[1vw] rounded-[1.7vh] border border-border bg-card/92 px-[1.5vw] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] transition-colors focus-within:border-accent/50">
                  <UserRound className="h-[2.6vh] w-[2.6vh] text-text-muted" />
                  <input
                    type="text"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="请输入用户名"
                    autoComplete="username"
                    disabled={isSubmitting}
                    className="w-full bg-transparent text-[2.35vh] text-text outline-none placeholder:text-text-muted"
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-[1vh] block text-[2.1vh] text-text-muted">密码</span>
                <div className="flex h-[8.5vh] items-center gap-[1vw] rounded-[1.7vh] border border-border bg-card/92 px-[1.5vw] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] transition-colors focus-within:border-accent/50">
                  <LockKeyhole className="h-[2.6vh] w-[2.6vh] text-text-muted" />
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="请输入密码"
                    autoComplete="current-password"
                    disabled={isSubmitting}
                    className="w-full bg-transparent text-[2.35vh] text-text outline-none placeholder:text-text-muted"
                  />
                </div>
              </label>

              {error ? (
                <div className="rounded-[1.7vh] border border-red-200 bg-red-50 px-[1.5vw] py-[1.8vh] text-[2.1vh] text-red-700">
                  {error}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={isSubmitting}
                className="flex h-[8.5vh] w-full items-center justify-center gap-[0.8vw] rounded-[1.7vh] border border-accent bg-accent px-[1.5vw] text-[2.25vh] font-medium text-white shadow-sm transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? <Loader className="h-[2.7vh] w-[2.7vh] animate-spin" /> : null}
                {isSubmitting ? '登录中...' : '登录'}
              </button>
            </form>
          </div>
        </section>
      </main>
    </motion.div>
  );
}
