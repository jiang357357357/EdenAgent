import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ArrowLeft,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ListChecks,
  NotebookPen,
  Plus,
  RefreshCw,
  Search,
  TimerReset,
  X,
} from "lucide-react"
import { motion } from "motion/react"
import {
  completeMemo,
  createMemo,
  listMemos,
  snoozeMemo,
  updateMemo,
  type ApiMemo,
  type ApiMemoKind,
  type ApiMemoPriority,
  type ApiMemoStatus,
} from "../../lib/mon_agent_api"
import { cn } from "../../lib/utils"
import { formatLocalMonthDayTime, fromDateTimeLocalInputValue, toDateTimeLocalInputValue } from "../../lib/time"
import diaryPaperTexture from "../../assets/self-awake/diary-paper.png"
import memoWorkspaceBackground from "../../assets/self-awake/memo-workspace-bg-v2.png"

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
    tone: "border-stone-200/70 bg-white/40 text-stone-700",
    rail: "bg-stone-300/80",
  },
  reminder: {
    label: "提醒",
    icon: Bell,
    tone: "border-stone-200/70 bg-white/40 text-stone-700",
    rail: "bg-stone-400/80",
  },
  todo: {
    label: "待办",
    icon: ListChecks,
    tone: "border-stone-200/70 bg-white/40 text-stone-700",
    rail: "bg-stone-400/80",
  },
}

const statusMeta: Record<ApiMemoStatus, { label: string; tone: string }> = {
  active: { label: "进行中", tone: "border-stone-200/70 bg-white/42 text-stone-700" },
  done: { label: "已完成", tone: "border-stone-200/70 bg-stone-100/52 text-stone-500" },
  archived: { label: "已归档", tone: "border-stone-200/70 bg-stone-100/52 text-stone-500" },
  cancelled: { label: "已取消", tone: "border-stone-200/70 bg-stone-100/52 text-stone-500" },
}

const priorityLabel: Record<ApiMemoPriority, string> = {
  low: "低",
  normal: "普通",
  high: "高",
}

const kindOptions: PaperSelectOption<ApiMemoKind>[] = [
  { value: "note", label: "备忘" },
  { value: "reminder", label: "提醒" },
  { value: "todo", label: "待办" },
]

const priorityOptions: PaperSelectOption<ApiMemoPriority>[] = [
  { value: "low", label: "低" },
  { value: "normal", label: "普通" },
  { value: "high", label: "高" },
]

const statusOptions: PaperSelectOption<ApiMemoStatus>[] = [
  { value: "active", label: "进行中" },
  { value: "done", label: "已完成" },
  { value: "archived", label: "已归档" },
  { value: "cancelled", label: "已取消" },
]

type StatusFilter = "active" | "done" | "all"
type KindFilter = "all" | ApiMemoKind
type EditorMode = "create" | "edit"

interface MemoPageProps {
  onBack: () => void
}

function triggerLabel(memo: ApiMemo) {
  if (memo.snoozed_until) return `稍后 ${formatLocalMonthDayTime(memo.snoozed_until)}`
  if (memo.remind_at) return `提醒 ${formatLocalMonthDayTime(memo.remind_at)}`
  if (memo.due_at) return `截止 ${formatLocalMonthDayTime(memo.due_at)}`
  return "未定时"
}

function paperStyle(alpha = 0.54) {
  return {
    backgroundImage: `linear-gradient(rgba(255, 253, 248, ${alpha}), rgba(255, 253, 248, ${alpha})), url(${diaryPaperTexture})`,
    backgroundSize: "auto, 560px auto",
  }
}

interface PaperSelectOption<T extends string> {
  label: string
  value: T
}

function PaperSelect<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T
  options: PaperSelectOption<T>[]
  onChange: (value: T) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((option) => option.value === value) ?? options[0]

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex h-[4.6vh] w-full items-center justify-between rounded-[0.65vh] border border-stone-200/65 bg-white/38 px-[1.2vh] text-[1.48vh] text-stone-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition-colors",
          "hover:border-stone-300/80 hover:bg-white/56 focus:border-stone-400/70 focus:outline-none",
          disabled && "cursor-not-allowed opacity-55",
        )}
      >
        <span>{selected.label}</span>
        <ChevronDown className={cn("h-[1.55vh] w-[1.55vh] text-stone-500 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+0.45vh)] z-30 overflow-hidden rounded-[0.75vh] border border-stone-200/70 bg-white/72 p-[0.45vh] shadow-[0_1.2vh_3.2vh_rgba(87,83,78,0.16)] backdrop-blur-md"
          style={paperStyle(0.72)}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
              className={cn(
                "flex h-[4vh] w-full items-center rounded-[0.55vh] px-[1vh] text-left text-[1.45vh] text-stone-700 transition-colors",
                option.value === value ? "bg-stone-200/44 text-stone-950" : "hover:bg-white/60",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function emptyForm() {
  return {
    title: "",
    content: "",
    kind: "note" as ApiMemoKind,
    status: "active" as ApiMemoStatus,
    priority: "normal" as ApiMemoPriority,
    remindAt: "",
    dueAt: "",
  }
}

export function MemoPage({ onBack }: MemoPageProps) {
  const [memos, setMemos] = useState<ApiMemo[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active")
  const [kindFilter, setKindFilter] = useState<KindFilter>("all")
  const [editorMode, setEditorMode] = useState<EditorMode>("create")
  const [editingMemo, setEditingMemo] = useState<ApiMemo | undefined>()
  const [editorOpen, setEditorOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)

  const loadMemos = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const data = await listMemos({
        q: query.trim() || undefined,
        limit: 160,
      })
      setMemos(data)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    void loadMemos()
  }, [loadMemos])

  const activeCount = memos.filter((memo) => memo.status === "active").length
  const doneCount = memos.filter((memo) => memo.status === "done").length
  const noteCount = memos.filter((memo) => memo.kind === "note").length
  const reminderCount = memos.filter((memo) => memo.kind === "reminder").length
  const todoCount = memos.filter((memo) => memo.kind === "todo").length
  const nextMemo = memos
    .filter((memo) => memo.status === "active" && memo.trigger_at)
    .sort((left, right) => new Date(left.trigger_at || 0).getTime() - new Date(right.trigger_at || 0).getTime())[0]

  const statusFilterOptions = useMemo<PaperSelectOption<StatusFilter>[]>(
    () => [
      { value: "active", label: `状态 进行中 ${activeCount}` },
      { value: "done", label: `状态 已完成 ${doneCount}` },
      { value: "all", label: `状态 全部 ${memos.length}` },
    ],
    [activeCount, doneCount, memos.length],
  )

  const kindFilterOptions = useMemo<PaperSelectOption<KindFilter>[]>(
    () => [
      { value: "all", label: `类型 全部 ${memos.length}` },
      { value: "note", label: `类型 备忘 ${noteCount}` },
      { value: "reminder", label: `类型 提醒 ${reminderCount}` },
      { value: "todo", label: `类型 待办 ${todoCount}` },
    ],
    [memos.length, noteCount, reminderCount, todoCount],
  )

  const visibleMemos = useMemo(() => {
    return memos.filter((memo) => {
      const matchesStatus = statusFilter === "all" || memo.status === statusFilter
      const matchesKind = kindFilter === "all" || memo.kind === kindFilter
      return matchesStatus && matchesKind
    })
  }, [kindFilter, memos, statusFilter])

  const openCreate = () => {
    setEditorMode("create")
    setEditingMemo(undefined)
    setForm(emptyForm())
    setError(undefined)
    setEditorOpen(true)
  }

  const openEdit = (memo: ApiMemo) => {
    setEditorMode("edit")
    setEditingMemo(memo)
    setForm({
      title: memo.title,
      content: memo.content ?? "",
      kind: memo.kind,
      status: memo.status,
      priority: memo.priority,
      remindAt: toDateTimeLocalInputValue(memo.remind_at),
      dueAt: toDateTimeLocalInputValue(memo.due_at),
    })
    setError(undefined)
    setEditorOpen(true)
  }

  const closeEditor = () => {
    if (saving) return
    setEditorOpen(false)
    setEditingMemo(undefined)
    setForm(emptyForm())
  }

  const handleSave = async () => {
    const cleanTitle = form.title.trim()
    if (!cleanTitle) {
      setError("标题不能为空。")
      return
    }
    if (form.kind === "reminder" && !form.remindAt && !form.dueAt) {
      setError("提醒需要设置提醒时间或截止时间。")
      return
    }

    setSaving(true)
    setError(undefined)
    try {
      const input = {
        title: cleanTitle,
        content: form.content.trim(),
        kind: form.kind,
        status: form.status,
        priority: form.priority,
        remind_at: fromDateTimeLocalInputValue(form.remindAt),
        due_at: fromDateTimeLocalInputValue(form.dueAt),
      }
      const memo =
        editorMode === "edit" && editingMemo
          ? await updateMemo(editingMemo.id, input)
          : await createMemo({ ...input, status: undefined })
      await loadMemos()
      setEditorOpen(false)
      setEditingMemo(memo)
      setForm(emptyForm())
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
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
      if (editingMemo?.id === updated.id) setEditingMemo(updated)
      setEditorOpen(false)
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
      setEditingMemo(updated)
      setForm((current) => ({ ...current, status: updated.status, remindAt: toDateTimeLocalInputValue(updated.remind_at) }))
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
      style={{ backgroundImage: `url(${memoWorkspaceBackground})` }}
    >
      <header className="flex h-[10.5vh] items-center justify-between border-b border-stone-200/45 bg-white/58 px-[2.8vw] shadow-sm backdrop-blur-md">
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
          <div className="flex h-[5.7vh] w-[5.7vh] rotate-[-2deg] items-center justify-center rounded-[1.1vh] border border-stone-200/70 bg-white/72 text-stone-700 shadow-sm">
            <NotebookPen className="h-[2.7vh] w-[2.7vh]" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-serif text-[3.35vh] text-text">备忘录</h1>
            <p className="truncate text-[1.6vh] text-text-muted">
              {memos.length} 张纸条 · {reminderCount} 个提醒 · 下次 {nextMemo ? formatLocalMonthDayTime(nextMemo.trigger_at) : "-"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-[0.75vw]">
          <button
            type="button"
            onClick={() => void loadMemos()}
            className="flex items-center gap-[0.5vw] rounded-full border border-stone-200/70 bg-white/68 px-[1.15vw] py-[0.95vh] text-[1.55vh] text-text-muted shadow-sm backdrop-blur-[1px] transition-colors hover:border-stone-300 hover:text-text"
          >
            <RefreshCw className={cn("h-[1.9vh] w-[1.9vh]", loading && "animate-spin")} />
            刷新
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-[0.55vw] rounded-full border border-amber-700/20 bg-amber-600 px-[1.25vw] py-[0.95vh] text-[1.58vh] font-medium text-white shadow-sm transition-colors hover:bg-amber-700"
          >
            <Plus className="h-[1.95vh] w-[1.95vh]" />
            新纸条
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden px-[3vw] py-[2.2vh]">
        <section className="mb-[1.75vh] flex flex-wrap items-center gap-[1.05vh]">
          <div className="relative min-w-[32vh] flex-1">
            <Search className="absolute left-[1.25vh] top-1/2 h-[1.9vh] w-[1.9vh] -translate-y-1/2 text-stone-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索纸条"
              className="h-[5.4vh] w-full rounded-[0.8vh] border border-stone-200/70 bg-white/58 pl-[4.25vh] pr-[1.35vh] text-[1.72vh] text-text shadow-sm outline-none backdrop-blur-[1px] transition-colors placeholder:text-text-lighter focus:border-stone-400/70"
            />
          </div>
          <div className="grid w-full grid-cols-2 gap-[1vh] sm:w-auto">
            <div className="w-full sm:w-[18vh]">
              <PaperSelect<StatusFilter> value={statusFilter} options={statusFilterOptions} onChange={setStatusFilter} />
            </div>
            <div className="w-full sm:w-[18vh]">
              <PaperSelect<KindFilter> value={kindFilter} options={kindFilterOptions} onChange={setKindFilter} />
            </div>
          </div>
        </section>

        {error && (
          <div className="mb-[1.2vh] rounded-[0.8vh] border border-stone-300 bg-white/86 px-[1vw] py-[1vh] text-[1.55vh] text-stone-700">
            {error}
          </div>
        )}

        <section className="min-h-0 flex-1 overflow-y-auto rounded-[1vh] border border-stone-200/45 bg-white/18 p-[1.8vh] shadow-[0_18px_48px_rgba(120,113,108,0.08)] backdrop-blur-[1px]">
          {visibleMemos.length === 0 ? (
            <button
              type="button"
              onClick={openCreate}
              className="flex h-full min-h-[46vh] w-full flex-col items-center justify-center rounded-[0.9vh] border border-stone-200/45 bg-white/28 text-center text-text-muted transition-colors hover:border-stone-300/70 hover:bg-white/42"
            >
              <NotebookPen className="mb-[1.5vh] h-[5.8vh] w-[5.8vh] text-stone-400" />
              <p className="font-serif text-[2.8vh] text-text">还没有纸条</p>
              <p className="mt-[0.8vh] text-[1.6vh]">写下第一条备忘。</p>
            </button>
          ) : (
            <div className="grid auto-rows-fr grid-cols-3 gap-[1.65vh]">
              {visibleMemos.map((memo) => {
                const KindIcon = kindMeta[memo.kind].icon
                return (
                  <button
                    key={memo.id}
                    type="button"
                    onClick={() => openEdit(memo)}
                    className="group relative min-h-[19.2vh] overflow-hidden rounded-[0.85vh] border border-stone-200/58 px-[2.25vh] pb-[5.35vh] pt-[0.95vh] text-left shadow-[0_12px_28px_rgba(120,113,108,0.1)] transition-colors hover:border-stone-300/80 focus-visible:border-stone-400/80 focus-visible:outline-none"
                    style={paperStyle(0.58)}
                  >
                    <span
                      className={cn(
                        "absolute inset-y-[1.2vh] left-0 w-[0.36vh] rounded-r-full transition-[width,opacity] duration-200 group-hover:w-[0.72vh] group-hover:opacity-100 group-focus-visible:w-[0.72vh] group-focus-visible:opacity-100",
                        kindMeta[memo.kind].rail,
                      )}
                    />
                    <h2 className="line-clamp-2 font-serif text-[2.65vh] leading-[1.18] text-text">{memo.title}</h2>
                    <p className="mt-[0.82vh] line-clamp-4 text-[1.68vh] leading-relaxed text-text-muted">
                      {memo.content || "没有正文。"}
                    </p>
                    <div className="absolute inset-x-[2.25vh] bottom-[0.95vh] flex items-end justify-between gap-[1.1vh] border-t border-stone-200/35 pt-[0.68vh] text-[1.26vh] text-text-lighter">
                      <div className="grid min-w-0 gap-[0.22vh] leading-tight">
                        <span className="truncate">{triggerLabel(memo)}</span>
                        <span className="truncate">创建 {formatLocalMonthDayTime(memo.created_at)}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-[0.65vh]">
                        <span className={cn("inline-flex items-center gap-[0.5vh] rounded-full border px-[1vh] py-[0.32vh] text-[1.2vh]", kindMeta[memo.kind].tone)}>
                          <KindIcon className="h-[1.42vh] w-[1.42vh]" />
                          {kindMeta[memo.kind].label}
                        </span>
                        <span className={cn("rounded-full border px-[1vh] py-[0.32vh] text-[1.18vh]", statusMeta[memo.status].tone)}>
                          {statusMeta[memo.status].label}
                        </span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </section>
      </main>

      {editorOpen && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-stone-900/16 px-[2vw] py-[2vh] backdrop-blur-[2px]">
          <motion.section
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={transition}
            className="relative flex max-h-[84vh] w-[min(112vh,86vw)] flex-col overflow-hidden rounded-[1vh] border border-stone-200/70 shadow-[0_24px_70px_rgba(68,64,60,0.22)]"
            style={paperStyle(0.72)}
          >
            <div className="pointer-events-none absolute left-[3.2vh] top-0 h-full border-l border-stone-200/70" />
            <div className="relative z-10 flex items-center justify-between border-b border-stone-200/45 px-[3.2vh] py-[1.55vh]">
              <div className="min-w-0">
                <div className="text-[1.35vh] uppercase tracking-[0.16em] text-text-muted">
                  {editorMode === "create" ? "新纸条" : `纸条 #${editingMemo?.id ?? ""}`}
                </div>
                <div className="truncate font-serif text-[2.8vh] text-text">
                  {editorMode === "create" ? "写一张新的备忘" : "查看与编辑"}
                </div>
              </div>
              <button
                type="button"
                onClick={closeEditor}
                className="rounded-full border border-stone-200/60 bg-white/44 p-[0.75vh] text-text-muted shadow-sm transition-colors hover:text-text"
                aria-label="关闭"
                title="关闭"
              >
                <X className="h-[2.1vh] w-[2.1vh]" />
              </button>
            </div>

            <div className="relative z-10 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_30vh] overflow-hidden">
              <div className="min-h-0 overflow-y-auto px-[3.2vh] py-[2.4vh] pr-[2.8vh]">
                <input
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="标题"
                  className="w-full border-0 bg-transparent font-serif text-[4.1vh] leading-tight text-text outline-none placeholder:text-text-lighter"
                />
                <textarea
                  value={form.content}
                  onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
                  placeholder="想记下什么"
                  className="mt-[2.2vh] min-h-[43vh] w-full resize-none border-0 bg-transparent font-serif text-[2.25vh] leading-[2] text-text outline-none placeholder:text-text-lighter"
                />
              </div>

              <aside className="min-h-0 overflow-y-auto border-l border-stone-200/45 bg-white/18 px-[2vh] py-[2.1vh] backdrop-blur-[1px]">
                <div className="font-serif text-[2.1vh] text-text">属性</div>
                <div className="mt-[1.5vh] grid gap-[1.15vh]">
                  <label className="grid gap-[0.45vh] text-[1.22vh] text-text-muted">
                    类型
                    <PaperSelect value={form.kind} options={kindOptions} onChange={(kind) => setForm((current) => ({ ...current, kind }))} />
                  </label>
                  <label className="grid gap-[0.45vh] text-[1.22vh] text-text-muted">
                    优先级
                    <PaperSelect
                      value={form.priority}
                      options={priorityOptions}
                      onChange={(priority) => setForm((current) => ({ ...current, priority }))}
                    />
                  </label>
                  {editorMode === "edit" && (
                    <label className="grid gap-[0.45vh] text-[1.22vh] text-text-muted">
                      状态
                      <PaperSelect value={form.status} options={statusOptions} onChange={(status) => setForm((current) => ({ ...current, status }))} />
                    </label>
                  )}
                </div>

                <div className="mt-[2.2vh] grid gap-[1.15vh]">
                  <label className="grid gap-[0.45vh] text-[1.22vh] text-text-muted">
                    提醒时间
                    <input
                      value={form.remindAt}
                      onChange={(event) => setForm((current) => ({ ...current, remindAt: event.target.value }))}
                      type="datetime-local"
                      className="h-[4.4vh] rounded-[0.65vh] border border-stone-200/65 bg-white/46 px-[1vh] text-[1.38vh] text-text outline-none focus:border-stone-400/70"
                    />
                  </label>
                  <label className="grid gap-[0.45vh] text-[1.22vh] text-text-muted">
                    截止时间
                    <input
                      value={form.dueAt}
                      onChange={(event) => setForm((current) => ({ ...current, dueAt: event.target.value }))}
                      type="datetime-local"
                      className="h-[4.4vh] rounded-[0.65vh] border border-stone-200/65 bg-white/46 px-[1vh] text-[1.38vh] text-text outline-none focus:border-stone-400/70"
                    />
                  </label>
                </div>

                {editingMemo && (
                  <div className="mt-[2.1vh] grid gap-[0.55vh] border-t border-stone-200/45 pt-[1.25vh] text-[1.24vh] text-text-muted">
                    <span>{triggerLabel(editingMemo)}</span>
                    <span>创建 {formatLocalMonthDayTime(editingMemo.created_at)}</span>
                    <span>更新 {formatLocalMonthDayTime(editingMemo.updated_at)}</span>
                  </div>
                )}
              </aside>
            </div>

            <div className="relative z-10 flex items-center justify-between border-t border-stone-200/45 bg-white/34 px-[3.2vh] py-[1.35vh] backdrop-blur-[1px]">
              <div className="flex items-center gap-[0.8vh]">
                {editingMemo && (
                  <button
                    type="button"
                    onClick={() => void handleSnooze(editingMemo, 30)}
                    disabled={saving || editingMemo.status !== "active"}
                    className="flex items-center gap-[0.55vh] rounded-full border border-stone-200/65 bg-white/52 px-[1.25vh] py-[0.82vh] text-[1.5vh] text-text-muted shadow-sm transition-colors hover:border-stone-300 hover:text-text disabled:opacity-50"
                  >
                    <TimerReset className="h-[1.8vh] w-[1.8vh]" />
                    30 分钟后
                  </button>
                )}
                {editingMemo && (
                  <button
                    type="button"
                    onClick={() => void handleComplete(editingMemo)}
                    disabled={saving || editingMemo.status === "done"}
                    className="flex items-center gap-[0.55vh] rounded-full border border-stone-200/65 bg-white/52 px-[1.25vh] py-[0.82vh] text-[1.5vh] text-text-muted shadow-sm transition-colors hover:border-stone-300 hover:text-text disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-[1.8vh] w-[1.8vh]" />
                    完成
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="flex items-center gap-[0.6vh] rounded-full border border-amber-700/20 bg-amber-600 px-[1.7vh] py-[0.9vh] text-[1.58vh] font-medium text-white shadow-sm transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Check className="h-[1.85vh] w-[1.85vh]" />
                保存
              </button>
            </div>
          </motion.section>
        </div>
      )}
    </motion.div>
  )
}
