import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ArrowLeft,
  Bell,
  Check,
  CheckCircle2,
  Clock3,
  ListChecks,
  NotebookPen,
  Plus,
  RefreshCw,
  Search,
  TimerReset,
} from "lucide-react"
import { motion } from "motion/react"
import {
  completeMemo,
  createMemo,
  listMemos,
  snoozeMemo,
  type ApiMemo,
  type ApiMemoKind,
  type ApiMemoPriority,
  type ApiMemoStatus,
} from "../../lib/mon_agent_api"
import { cn } from "../../lib/utils"
import diaryPaperTexture from "../../assets/self-awake/diary-paper.png"
import journalWorkspaceBackground from "../../assets/self-awake/journal-workspace-bg.png"

const screenMotion = {
  initial: { opacity: 0, y: 16, filter: "blur(3px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: 18, filter: "blur(3px)" },
}

const transition = {
  duration: 0.25,
  ease: [0.16, 1, 0.3, 1],
} as const

const kindMeta: Record<ApiMemoKind, { label: string; icon: typeof NotebookPen; tone: string; rail: string }> = {
  note: {
    label: "备忘",
    icon: NotebookPen,
    tone: "border-stone-200 bg-stone-50/85 text-stone-700",
    rail: "bg-stone-300",
  },
  reminder: {
    label: "提醒",
    icon: Bell,
    tone: "border-orange-200 bg-orange-50/90 text-orange-700",
    rail: "bg-orange-500",
  },
  todo: {
    label: "待办",
    icon: ListChecks,
    tone: "border-sky-200 bg-sky-50/90 text-sky-700",
    rail: "bg-sky-500",
  },
}

const statusMeta: Record<ApiMemoStatus, { label: string; tone: string }> = {
  active: { label: "进行中", tone: "border-emerald-200 bg-emerald-50/90 text-emerald-700" },
  done: { label: "已完成", tone: "border-stone-200 bg-stone-100/90 text-stone-500" },
  archived: { label: "已归档", tone: "border-stone-200 bg-stone-100/90 text-stone-500" },
  cancelled: { label: "已取消", tone: "border-rose-200 bg-rose-50/90 text-rose-600" },
}

const priorityLabel: Record<ApiMemoPriority, string> = {
  low: "低",
  normal: "普通",
  high: "高",
}

interface MemoPageProps {
  onBack: () => void
}

function formatDateTime(value?: string | null) {
  if (!value) return "-"
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "-"
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function fromDateTimeLocal(value: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function triggerLabel(memo: ApiMemo) {
  if (memo.snoozed_until) return `稍后 ${formatDateTime(memo.snoozed_until)}`
  if (memo.remind_at) return `提醒 ${formatDateTime(memo.remind_at)}`
  if (memo.due_at) return `截止 ${formatDateTime(memo.due_at)}`
  return "未定时"
}

function paperStyle(alpha = 0.75) {
  return {
    backgroundImage: `linear-gradient(rgba(255, 253, 248, ${alpha}), rgba(255, 253, 248, ${alpha})), url(${diaryPaperTexture})`,
    backgroundSize: "auto, 560px auto",
  }
}

function CountPill({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex h-[4.8vh] items-center justify-between rounded-[0.7vh] border border-orange-200/70 bg-[#fff9ee]/78 px-[0.85vw] shadow-sm">
      <span className="text-[1.35vh] uppercase tracking-[0.14em] text-text-muted">{label}</span>
      <span className="font-serif text-[2.25vh] text-text">{value}</span>
    </div>
  )
}

export function MemoPage({ onBack }: MemoPageProps) {
  const [memos, setMemos] = useState<ApiMemo[]>([])
  const [selectedID, setSelectedID] = useState<number | undefined>()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<ApiMemoStatus | "all">("active")
  const [kindFilter, setKindFilter] = useState<ApiMemoKind | "all">("all")
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [kind, setKind] = useState<ApiMemoKind>("note")
  const [priority, setPriority] = useState<ApiMemoPriority>("normal")
  const [remindAt, setRemindAt] = useState("")
  const [dueAt, setDueAt] = useState("")

  const loadMemos = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const data = await listMemos({
        q: query.trim() || undefined,
        status: statusFilter === "all" ? undefined : statusFilter,
        kind: kindFilter === "all" ? undefined : kindFilter,
        limit: 120,
      })
      setMemos(data)
      setSelectedID((current) => (current && data.some((memo) => memo.id === current) ? current : data[0]?.id))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [kindFilter, query, statusFilter])

  useEffect(() => {
    void loadMemos()
  }, [loadMemos])

  const selectedMemo = useMemo(() => memos.find((memo) => memo.id === selectedID) ?? memos[0], [memos, selectedID])
  const activeCount = memos.filter((memo) => memo.status === "active").length
  const reminderCount = memos.filter((memo) => memo.kind === "reminder").length
  const nextMemo = memos
    .filter((memo) => memo.status === "active" && memo.trigger_at)
    .sort((left, right) => new Date(left.trigger_at || 0).getTime() - new Date(right.trigger_at || 0).getTime())[0]

  const resetForm = () => {
    setTitle("")
    setContent("")
    setKind("note")
    setPriority("normal")
    setRemindAt("")
    setDueAt("")
  }

  const handleCreate = async () => {
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setError("标题不能为空。")
      return
    }
    if (kind === "reminder" && !remindAt && !dueAt) {
      setError("提醒需要设置提醒时间或截止时间。")
      return
    }

    setSaving(true)
    setError(undefined)
    try {
      const memo = await createMemo({
        title: cleanTitle,
        content: content.trim(),
        kind,
        priority,
        remind_at: fromDateTimeLocal(remindAt),
        due_at: fromDateTimeLocal(dueAt),
      })
      resetForm()
      await loadMemos()
      setSelectedID(memo.id)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError))
    } finally {
      setSaving(false)
    }
  }

  const handleComplete = async (memo: ApiMemo) => {
    setSaving(true)
    setError(undefined)
    try {
      const updated = await completeMemo(memo.id)
      setMemos((items) => items.map((item) => (item.id === updated.id ? updated : item)))
      setSelectedID(updated.id)
    } catch (completeError) {
      setError(completeError instanceof Error ? completeError.message : String(completeError))
    } finally {
      setSaving(false)
    }
  }

  const handleSnooze = async (memo: ApiMemo, minutes: number) => {
    setSaving(true)
    setError(undefined)
    try {
      const updated = await snoozeMemo(memo.id, { minutes })
      setMemos((items) => items.map((item) => (item.id === updated.id ? updated : item)))
      setSelectedID(updated.id)
    } catch (snoozeError) {
      setError(snoozeError instanceof Error ? snoozeError.message : String(snoozeError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      key="memo"
      {...screenMotion}
      transition={transition}
      className="fixed inset-0 z-10 flex h-[100vh] w-[100vw] flex-col overflow-hidden bg-bg bg-cover bg-center font-sans text-text"
      style={{
        backgroundImage: `linear-gradient(rgba(245, 245, 244, 0.48), rgba(245, 245, 244, 0.52)), url(${journalWorkspaceBackground})`,
      }}
    >
      <header className="flex h-[10.5vh] items-center justify-between border-b border-white/45 bg-bg/68 px-[2.8vw] shadow-sm backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-[1.15vw]">
          <button
            type="button"
            onClick={onBack}
            className="rounded-[1vh] p-[1.15vh] text-text-muted transition-colors hover:bg-card/80 hover:text-text"
            aria-label="返回聊天"
            title="返回聊天"
          >
            <ArrowLeft className="h-[2.7vh] w-[2.7vh]" />
          </button>
          <div className="flex h-[5.7vh] w-[5.7vh] rotate-[-2deg] items-center justify-center rounded-[1.1vh] border border-accent/25 bg-[#fff7e8] text-accent shadow-sm">
            <NotebookPen className="h-[2.7vh] w-[2.7vh]" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-serif text-[3.35vh] text-text">备忘录</h1>
            <p className="truncate text-[1.6vh] text-text-muted">把临时念头收进纸页里。</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadMemos()}
          className="flex items-center gap-[0.5vw] rounded-full border border-orange-200/70 bg-[#fffaf0]/82 px-[1.15vw] py-[0.95vh] text-[1.55vh] text-text-muted shadow-sm transition-colors hover:border-accent/45 hover:text-accent"
        >
          <RefreshCw className={cn("h-[1.9vh] w-[1.9vh]", loading && "animate-spin")} />
          刷新
        </button>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[34vw_minmax(0,1fr)] gap-[1.7vw] overflow-hidden p-[2vw]">
        <section
          className="relative flex min-h-0 flex-col overflow-hidden rounded-[0.9vh] border border-orange-200/55 shadow-[0_18px_40px_rgba(120,113,108,0.16)] backdrop-blur-[2px]"
          style={paperStyle(0.66)}
        >
          <div className="pointer-events-none absolute left-[1.8vw] top-0 h-full border-l border-dashed border-orange-200/80" />
          <div className="relative z-10 border-b border-orange-200/65 px-[1.55vw] py-[1.65vh]">
            <div className="mb-[1.15vh] grid grid-cols-3 gap-[0.65vw]">
              <CountPill label="总数" value={memos.length} />
              <CountPill label="进行中" value={activeCount} />
              <CountPill label="提醒" value={reminderCount} />
            </div>
            <div className="relative">
              <Search className="absolute left-[0.85vw] top-1/2 h-[1.9vh] w-[1.9vh] -translate-y-1/2 text-accent" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索纸条"
                className="h-[5vh] w-full rounded-[0.75vh] border border-orange-200/75 bg-[#fffdf8]/72 pl-[2.6vw] pr-[1vw] text-[1.72vh] text-text shadow-inner outline-none transition-colors placeholder:text-text-lighter focus:border-accent/55"
              />
            </div>
            <div className="mt-[1.1vh] flex flex-wrap gap-[0.5vw]">
              {(["active", "done", "all"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setStatusFilter(item)}
                  className={cn(
                    "rounded-full border px-[0.85vw] py-[0.6vh] text-[1.42vh] shadow-sm transition-colors",
                    statusFilter === item
                      ? "border-accent bg-accent text-white"
                      : "border-orange-200/80 bg-[#fffaf1]/80 text-text-muted hover:border-accent/45 hover:text-accent",
                  )}
                >
                  {item === "all" ? "全部" : statusMeta[item].label}
                </button>
              ))}
              {(["all", "note", "reminder", "todo"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setKindFilter(item)}
                  className={cn(
                    "rounded-full border px-[0.85vw] py-[0.6vh] text-[1.42vh] shadow-sm transition-colors",
                    kindFilter === item
                      ? "border-accent bg-accent text-white"
                      : "border-orange-200/80 bg-[#fffaf1]/80 text-text-muted hover:border-accent/45 hover:text-accent",
                  )}
                >
                  {item === "all" ? "所有类型" : kindMeta[item].label}
                </button>
              ))}
            </div>
          </div>

          <div className="relative z-10 min-h-0 flex-1 overflow-y-auto px-[1.15vw] py-[1.2vh]">
            {error && (
              <div className="mb-[1vh] rounded-[0.8vh] border border-rose-200 bg-rose-50/92 px-[1vw] py-[1vh] text-[1.55vh] text-rose-700">
                {error}
              </div>
            )}
            {memos.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center text-text-muted">
                <NotebookPen className="mb-[1.5vh] h-[5.4vh] w-[5.4vh] text-accent/70" />
                <p className="font-serif text-[2.7vh] text-text">还没有纸条</p>
                <p className="mt-[0.8vh] text-[1.6vh]">写下第一条备忘。</p>
              </div>
            ) : (
              <div className="space-y-[0.9vh] pl-[1vw]">
                {memos.map((memo, index) => {
                  const KindIcon = kindMeta[memo.kind].icon
                  const selected = selectedMemo?.id === memo.id
                  return (
                    <button
                      key={memo.id}
                      type="button"
                      onClick={() => setSelectedID(memo.id)}
                      className={cn(
                        "group relative flex w-full min-w-0 items-start gap-[0.8vw] rounded-[0.75vh] border px-[0.9vw] py-[1.05vh] text-left shadow-sm transition-all",
                        selected
                          ? "translate-x-[0.25vw] border-accent bg-[#fff6df]/92 shadow-md"
                          : "border-orange-100/90 bg-[#fffdf8]/76 hover:translate-x-[0.18vw] hover:border-accent/35 hover:bg-[#fff9ed]/90",
                      )}
                    >
                      <span className={cn("absolute bottom-[0.8vh] left-[-0.95vw] top-[0.8vh] w-[0.18vw] rounded-full", kindMeta[memo.kind].rail)} />
                      <div
                        className={cn(
                          "flex h-[4.4vh] w-[4.4vh] flex-none items-center justify-center rounded-[0.7vh] border shadow-sm",
                          kindMeta[memo.kind].tone,
                        )}
                      >
                        <KindIcon className="h-[2.05vh] w-[2.05vh]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-[0.45vw]">
                          <span className="truncate font-serif text-[2.05vh] text-text">{memo.title}</span>
                          <span className="flex-none text-[1.15vh] text-text-lighter">#{index + 1}</span>
                        </div>
                        <div className="mt-[0.42vh] truncate text-[1.48vh] text-text-muted">
                          {memo.content || triggerLabel(memo)}
                        </div>
                        <div className="mt-[0.65vh] flex items-center gap-[0.65vw] text-[1.25vh] text-text-lighter">
                          <span>{kindMeta[memo.kind].label}</span>
                          <span>{triggerLabel(memo)}</span>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="relative z-10 border-t border-orange-200/65 bg-[#fff8ea]/62 px-[1.45vw] py-[1.45vh]">
            <div className="mb-[0.9vh] flex items-center gap-[0.55vw] font-serif text-[2vh] text-text">
              <Plus className="h-[2vh] w-[2vh] text-accent" />
              新便签
            </div>
            <div className="grid gap-[0.75vh]">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="写个标题"
                className="h-[4.7vh] rounded-[0.65vh] border border-orange-200/80 bg-[#fffdf8]/88 px-[0.85vw] text-[1.7vh] shadow-inner outline-none focus:border-accent/50"
              />
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="想记下什么"
                rows={2}
                className="resize-none rounded-[0.65vh] border border-orange-200/80 bg-[#fffdf8]/88 px-[0.85vw] py-[0.85vh] text-[1.6vh] leading-relaxed shadow-inner outline-none focus:border-accent/50"
              />
              <div className="grid grid-cols-3 gap-[0.6vw]">
                <select value={kind} onChange={(event) => setKind(event.target.value as ApiMemoKind)} className="h-[4.45vh] rounded-[0.65vh] border border-orange-200/80 bg-[#fffdf8] px-[0.7vw] text-[1.55vh]">
                  <option value="note">备忘</option>
                  <option value="reminder">提醒</option>
                  <option value="todo">待办</option>
                </select>
                <select value={priority} onChange={(event) => setPriority(event.target.value as ApiMemoPriority)} className="h-[4.45vh] rounded-[0.65vh] border border-orange-200/80 bg-[#fffdf8] px-[0.7vw] text-[1.55vh]">
                  <option value="low">低</option>
                  <option value="normal">普通</option>
                  <option value="high">高</option>
                </select>
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={saving}
                  className="flex h-[4.45vh] items-center justify-center gap-[0.45vw] rounded-[0.65vh] border border-accent bg-accent px-[0.7vw] text-[1.55vh] font-medium text-white shadow-sm transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Check className="h-[1.8vh] w-[1.8vh]" />
                  保存
                </button>
              </div>
              <div className="grid grid-cols-2 gap-[0.6vw]">
                <label className="grid gap-[0.35vh] text-[1.25vh] text-text-muted">
                  提醒时间
                  <input value={remindAt} onChange={(event) => setRemindAt(event.target.value)} type="datetime-local" className="h-[4.2vh] rounded-[0.65vh] border border-orange-200/80 bg-[#fffdf8] px-[0.65vw] text-[1.45vh] text-text" />
                </label>
                <label className="grid gap-[0.35vh] text-[1.25vh] text-text-muted">
                  截止时间
                  <input value={dueAt} onChange={(event) => setDueAt(event.target.value)} type="datetime-local" className="h-[4.2vh] rounded-[0.65vh] border border-orange-200/80 bg-[#fffdf8] px-[0.65vw] text-[1.45vh] text-text" />
                </label>
              </div>
            </div>
          </div>
        </section>

        <section className="relative min-h-0 overflow-hidden rounded-[0.9vh] border border-orange-200/45 shadow-[0_18px_48px_rgba(120,113,108,0.14)]" style={paperStyle(0.6)}>
          <div className="pointer-events-none absolute left-[3.2vw] top-0 h-full border-l border-orange-200/75" />
          <div className="pointer-events-none absolute inset-x-[2vw] top-[12vh] bottom-[3vh] opacity-55" style={{
            backgroundImage: "repeating-linear-gradient(to bottom, transparent 0, transparent 5.1vh, rgba(120,113,108,0.18) 5.18vh, transparent 5.28vh)",
          }} />
          <div className="relative z-10 flex h-full min-h-0 flex-col">
            <div className="flex h-[10vh] items-center justify-between border-b border-orange-200/55 px-[2vw]">
              <div className="min-w-0">
                <div className="text-[1.35vh] uppercase tracking-[0.18em] text-text-muted">下一次提醒</div>
                <div className="truncate font-serif text-[2.7vh] text-text">{nextMemo ? formatDateTime(nextMemo.trigger_at) : "-"}</div>
              </div>
              <div className="rounded-full border border-orange-200/70 bg-[#fff9ef]/78 px-[1vw] py-[0.65vh] text-[1.42vh] text-text-muted">
                {statusFilter === "all" ? "全部" : statusMeta[statusFilter].label}
              </div>
            </div>

            {selectedMemo ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="px-[4.8vw] pb-[1.2vh] pt-[3.2vh]">
                  <div className="mb-[1.2vh] flex flex-wrap items-center gap-[0.55vw]">
                    <span className={cn("rounded-full border px-[0.8vw] py-[0.38vh] text-[1.35vh]", kindMeta[selectedMemo.kind].tone)}>
                      {kindMeta[selectedMemo.kind].label}
                    </span>
                    <span className={cn("rounded-full border px-[0.8vw] py-[0.38vh] text-[1.35vh]", statusMeta[selectedMemo.status].tone)}>
                      {statusMeta[selectedMemo.status].label}
                    </span>
                    <span className="rounded-full border border-orange-200/75 bg-[#fff9ef]/80 px-[0.8vw] py-[0.38vh] text-[1.35vh] text-text-muted">
                      优先级 {priorityLabel[selectedMemo.priority]}
                    </span>
                  </div>
                  <h2 className="max-w-[54vw] font-serif text-[5vh] leading-tight text-text">{selectedMemo.title}</h2>
                  <div className="mt-[1.2vh] flex flex-wrap items-center gap-[1vw] text-[1.6vh] text-text-muted">
                    <span>{triggerLabel(selectedMemo)}</span>
                    <span>更新 {formatDateTime(selectedMemo.updated_at)}</span>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-[4.8vw] py-[1.2vh]">
                  <p className="whitespace-pre-wrap font-serif text-[2.55vh] leading-[2.05] text-text">
                    {selectedMemo.content || "没有正文。"}
                  </p>
                </div>

                <div className="flex items-center justify-between border-t border-orange-200/55 bg-[#fff8ea]/52 px-[2vw] py-[1.35vh]">
                  <div className="text-[1.42vh] text-text-muted">纸条 #{selectedMemo.id}</div>
                  <div className="flex items-center gap-[0.75vw]">
                    <button
                      type="button"
                      onClick={() => void handleSnooze(selectedMemo, 30)}
                      disabled={saving || selectedMemo.status !== "active"}
                      className="flex items-center gap-[0.45vw] rounded-full border border-orange-200/80 bg-[#fffdf8]/88 px-[1vw] py-[0.82vh] text-[1.5vh] text-text-muted shadow-sm transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50"
                    >
                      <TimerReset className="h-[1.8vh] w-[1.8vh]" />
                      30 分钟后
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleComplete(selectedMemo)}
                      disabled={saving || selectedMemo.status === "done"}
                      className="flex items-center gap-[0.45vw] rounded-full border border-accent bg-accent px-[1vw] py-[0.82vh] text-[1.5vh] text-white shadow-sm transition-colors hover:bg-amber-700 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-[1.8vh] w-[1.8vh]" />
                      完成
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="relative z-10 flex h-full items-center justify-center text-text-muted">
                <div className="text-center">
                  <NotebookPen className="mx-auto mb-[1.4vh] h-[6vh] w-[6vh] text-accent/55" />
                  <div className="font-serif text-[2.5vh]">选择一张纸条</div>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </motion.div>
  )
}
