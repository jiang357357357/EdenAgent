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
      className="h-[100vh] w-[100vw] overflow-hidden bg-[linear-gradient(135deg,#f7f5f1_0%,#f2eee7_46%,#eef3f0_100%)] px-[3vw] py-[4vh] text-text"
    >
      <div className="pointer-events-none fixed inset-0 opacity-[0.42] [background-image:linear-gradient(rgba(120,113,108,0.13)_1px,transparent_1px),linear-gradient(90deg,rgba(120,113,108,0.1)_1px,transparent_1px)] [background-size:3vw_3vw]" />
      <div className="relative flex h-[92vh] w-full items-center">
        <div className="grid h-[84vh] w-full gap-[2vw] md:grid-cols-[1.08fr_0.92fr]">
          <section className="relative h-full overflow-hidden rounded-[3vh] border border-white/80 bg-card/78 px-[3vw] py-[4vh] shadow-[0_3vh_8vh_rgba(41,37,36,0.1)] backdrop-blur">
            <div className="absolute inset-x-0 top-0 h-[0.45vh] bg-accent" />
            <div className="absolute right-[3vw] top-[7vh] h-[18vh] w-[18vh] rounded-full border border-accent/10" />

            <div className="relative flex h-full flex-col justify-between">
              <div className="space-y-[5vh]">
                <div className="flex items-center justify-between gap-[1vw]">
                  <div className="flex items-center gap-[1vw]">
                    <div className="flex h-[5.6vh] w-[5.6vh] items-center justify-center rounded-[1.6vh] border border-accent/25 bg-accent/10 text-accent shadow-sm">
                      <Bot className="h-[2.7vh] w-[2.7vh]" />
                    </div>
                    <div>
                      <div className="font-serif text-2xl leading-none text-text">MonAgent</div>
                      <div className="mt-1 text-xs tracking-[0.16em] text-text-muted">本地智能体工作台</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-[0.6vw] rounded-full border border-accent/25 bg-accent/10 px-[1vw] py-[0.8vh] text-xs font-medium text-accent">
                    <span className="h-[0.9vh] w-[0.9vh] rounded-full bg-accent" />
                    就绪
                  </div>
                </div>

                <div className="rounded-[2.4vh] border border-border/90 bg-bg/62 p-[3vh] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
                  <div className="mb-[3vh] flex items-center justify-between border-b border-border/80 pb-[2.4vh]">
                    <div>
                      <div className="text-xs tracking-[0.16em] text-text-muted">AGENT ACCESS</div>
                      <h1 className="mt-[1vh] font-serif text-4xl leading-tight text-text">进入工作台</h1>
                    </div>
                    <div className="flex h-[5vh] w-[5vh] items-center justify-center rounded-[1.4vh] border border-border bg-card text-accent">
                      <KeyRound className="h-[2.2vh] w-[2.2vh]" />
                    </div>
                  </div>

                  <div className="grid gap-[1.4vh]">
                    <div className="flex items-center justify-between rounded-[1.6vh] border border-border bg-card/82 px-[1.5vw] py-[1.55vh]">
                      <span className="text-sm text-text">Core 用户</span>
                      <span className="text-xs text-text-muted">统一身份</span>
                    </div>
                    <div className="flex items-center justify-between rounded-[1.6vh] border border-border bg-card/82 px-[1.5vw] py-[1.55vh]">
                      <span className="text-sm text-text">Pi Runtime</span>
                      <span className="text-xs text-text-muted">工具执行</span>
                    </div>
                    <div className="flex items-center justify-between rounded-[1.6vh] border border-border bg-card/82 px-[1.5vw] py-[1.55vh]">
                      <span className="text-sm text-text">本地会话</span>
                      <span className="text-xs text-text-muted">自动保持</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-[1vw] text-xs text-text-muted">
                <div className="rounded-[1.7vh] border border-border/80 bg-card/70 px-[1vw] py-[1.5vh]">
                  <div className="mb-[1vh] h-[0.45vh] w-[3vw] rounded-full bg-accent" />
                  Core
                </div>
                <div className="rounded-[1.7vh] border border-border/80 bg-card/70 px-[1vw] py-[1.5vh]">
                  <div className="mb-[1vh] h-[0.45vh] w-[3vw] rounded-full bg-accent" />
                  Agent
                </div>
                <div className="rounded-[1.7vh] border border-border/80 bg-card/70 px-[1vw] py-[1.5vh]">
                  <div className="mb-[1vh] h-[0.45vh] w-[3vw] rounded-full bg-accent" />
                  Local
                </div>
              </div>
            </div>
          </section>

          <section className="h-full rounded-[3vh] border border-white/80 bg-white/76 px-[3vw] py-[5vh] shadow-[0_3vh_8vh_rgba(41,37,36,0.1)] backdrop-blur">
            <div className="space-y-[3vh]">
              <div>
                <div className="mb-[2vh] flex h-[5.6vh] w-[5.6vh] items-center justify-center rounded-[1.6vh] border border-accent/20 bg-accent/10 text-accent">
                  <KeyRound className="h-[2.4vh] w-[2.4vh]" />
                </div>
                <h2 className="text-3xl font-serif text-text">身份验证</h2>
                <p className="mt-2 text-sm text-text-muted">进入 MonAgent 工作台</p>
              </div>

              <form className="space-y-[2.2vh]" onSubmit={handleSubmit}>
                <label className="block">
                  <span className="mb-[1vh] block text-sm text-text-muted">用户名</span>
                  <div className="flex items-center gap-[1vw] rounded-[1.8vh] border border-border bg-card/90 px-[1.5vw] py-[1.7vh] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] transition-colors focus-within:border-accent/50">
                    <UserRound className="h-[2vh] w-[2vh] text-text-muted" />
                    <input
                      type="text"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder="请输入用户名"
                      autoComplete="username"
                      disabled={isSubmitting}
                      className="w-full bg-transparent text-sm text-text outline-none placeholder:text-text-muted"
                    />
                  </div>
                </label>

                <label className="block">
                  <span className="mb-[1vh] block text-sm text-text-muted">密码</span>
                  <div className="flex items-center gap-[1vw] rounded-[1.8vh] border border-border bg-card/90 px-[1.5vw] py-[1.7vh] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] transition-colors focus-within:border-accent/50">
                    <LockKeyhole className="h-[2vh] w-[2vh] text-text-muted" />
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="请输入密码"
                      autoComplete="current-password"
                      disabled={isSubmitting}
                      className="w-full bg-transparent text-sm text-text outline-none placeholder:text-text-muted"
                    />
                  </div>
                </label>

                {error ? (
                  <div className="rounded-[1.8vh] border border-red-200 bg-red-50 px-[1.5vw] py-[1.5vh] text-sm text-red-700">
                    {error}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex w-full items-center justify-center gap-[0.8vw] rounded-[1.8vh] border border-accent bg-accent px-[1.5vw] py-[1.8vh] text-sm font-medium text-white shadow-sm transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? <Loader className="h-[2vh] w-[2vh] animate-spin" /> : null}
                  {isSubmitting ? '登录中...' : '登录'}
                </button>
              </form>
            </div>
          </section>
        </div>
      </div>
    </motion.div>
  );
}
