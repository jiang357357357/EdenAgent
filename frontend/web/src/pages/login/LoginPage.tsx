import { useState } from 'react';
import { Loader, LockKeyhole, UserRound } from 'lucide-react';
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
      className="min-h-screen bg-bg px-6 py-8 text-text"
    >
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center">
        <div className="grid w-full gap-6 md:grid-cols-[1.08fr_0.92fr]">
          <section className="rounded-3xl border border-border bg-card px-8 py-10 shadow-sm">
            <div className="space-y-5">
              <div className="flex items-center gap-3 text-accent">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10">
                  <LockKeyhole className="h-5 w-5" />
                </div>
                <span className="text-xs uppercase tracking-[0.2em] text-text-muted">Agent Access</span>
              </div>
              <div className="space-y-3">
                <h1 className="text-4xl font-serif text-text">登录 Agent 控制台</h1>
                <p className="max-w-xl text-sm leading-7 text-text-muted">
                  使用 Core 用户系统进入 Agent 工作台，登录后会保持本地会话，并在启动时自动验证 token。
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-border bg-bg px-8 py-10 shadow-sm">
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-serif text-text">身份验证</h2>
                <p className="mt-2 text-sm text-text-muted">输入账号信息进入工作台。</p>
              </div>

              <form className="space-y-4" onSubmit={handleSubmit}>
                <label className="block">
                  <span className="mb-2 block text-sm text-text-muted">用户名</span>
                  <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
                    <UserRound className="h-4 w-4 text-text-muted" />
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
                  <span className="mb-2 block text-sm text-text-muted">密码</span>
                  <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
                    <LockKeyhole className="h-4 w-4 text-text-muted" />
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
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm font-medium text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? <Loader className="h-4 w-4 animate-spin" /> : null}
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
