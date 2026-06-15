import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  ArrowLeft,
  Bell,
  BookOpenText,
  CalendarDays,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  NotebookText,
  RefreshCw,
  Search,
  Sparkles,
  TimerReset,
  X,
} from "lucide-react"
import { motion } from "motion/react"
import diaryPaperTexture from "../../assets/self-awake/diary-paper.png"
import journalWorkspaceBackground from "../../assets/self-awake/journal-workspace-bg.png"
import type { AuthUser, CoreAssistant } from "../../lib/auth"
import { getErrorMessage } from "../../lib/auth"
import {
  listSelfAwakeRunsPage,
  type ApiSelfAwakeAction,
  type ApiSelfAwakeDiary,
  type ApiSelfAwakeRun,
  type ToolStatus,
} from "../../lib/mon_agent_api"
import { formatLocalMonthDayTime, formatLocalWeekday } from "../../lib/time"

const screenMotion = {
  initial: { opacity: 0, x: 18, filter: "blur(3px)" },
  animate: { opacity: 1, x: 0, filter: "blur(0px)" },
  exit: { opacity: 0, x: 26, filter: "blur(3px)" },
}

const transition = {
  duration: 0.28,
  ease: [0.16, 1, 0.3, 1],
} as const

interface SelfAwakePageProps {
  currentUser?: AuthUser | null
  assistant?: CoreAssistant | null
  toolStatus?: ToolStatus
  onBack: () => void
}

type StatusTone = "ok" | "warn" | "muted" | "danger"
type SelfAwakeView = "overview" | "diary"
type DiaryEntry = {
  run: ApiSelfAwakeRun
  diary: ApiSelfAwakeDiary
  timestamp: string
  dateKey: string
}
type DiaryDayGroup = {
  dateKey: string
  entries: DiaryEntry[]
  count: number
  latestTimestamp?: string
}
type DiaryMonthGroup = {
  monthKey: string
  days: DiaryDayGroup[]
  count: number
  latestTimestamp?: string
}
type DiaryYearGroup = {
  yearKey: string
  months: DiaryMonthGroup[]
  count: number
  latestTimestamp?: string
}

const statusMeta: Record<string, { label: string; tone: StatusTone }> = {
  succeeded: { label: "完成", tone: "ok" },
  failed: { label: "失败", tone: "danger" },
  running: { label: "运行中", tone: "warn" },
  pending: { label: "等待", tone: "muted" },
  skipped: { label: "跳过", tone: "muted" },
}

const actionLabels: Record<string, string> = {
  observe_only: "只观察",
  write_diary: "写日记",
  remind_user: "提醒用户",
  create_task: "创建任务",
  ask_user: "询问用户",
  run_safe_check: "安全检查",
  sync_context: "同步上下文",
  set_self_awake_timer: "设置定时器",
}

const selfAwakePageSize = 20

function toneClass(tone: StatusTone) {
  if (tone === "ok") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (tone === "warn") return "border-amber-200 bg-amber-50 text-amber-700"
  if (tone === "danger") return "border-red-200 bg-red-50 text-red-700"
  return "border-border bg-bg text-text-muted"
}

function treeNodeClass(active: boolean, level: "year" | "month" | "day") {
  const activeClass =
    level === "day"
      ? "border-accent/70 bg-card/82 shadow-sm ring-1 ring-accent/20 backdrop-blur-[1px]"
      : "border-accent/45 bg-card/78 shadow-sm backdrop-blur-[1px]"
  return active ? activeClass : "border-white/55 bg-card/58 shadow-sm backdrop-blur-[1px] hover:border-accent/35 hover:bg-card/78"
}

function formatDateTime(value?: string | null) {
  const formatted = formatLocalMonthDayTime(value)
  return formatted === "-" ? "未记录" : formatted
}

function parseDate(value?: string | null) {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function dateMillis(value?: string | null) {
  return parseDate(value)?.getTime() ?? 0
}

function pad2(value: number) {
  return String(value).padStart(2, "0")
}

function diaryTimestamp(run: ApiSelfAwakeRun, diary: ApiSelfAwakeDiary) {
  return diary.created_at ?? run.finished_at ?? run.created_at ?? run.started_at ?? ""
}

function diaryDateKey(value?: string | null) {
  const date = parseDate(value)
  if (!date) return "unknown"
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function diaryYearKey(dateKey?: string) {
  if (!dateKey || dateKey === "unknown") return "unknown"
  return dateKey.slice(0, 4)
}

function diaryMonthKey(dateKey?: string) {
  if (!dateKey || dateKey === "unknown") return "unknown"
  return dateKey.slice(0, 7)
}

function diaryYearTitle(yearKey?: string) {
  if (!yearKey || yearKey === "unknown") return "未记录年份"
  return `${yearKey} 年`
}

function diaryMonthTitle(monthKey?: string) {
  if (!monthKey || monthKey === "unknown") return "未记录月份"
  const [, month] = monthKey.split("-")
  return `${month} 月`
}

function diaryDateTitle(dateKey?: string) {
  if (!dateKey || dateKey === "unknown") return "未记录日期"
  const [year, month, day] = dateKey.split("-")
  return `${year}年${month}月${day}日`
}

function diaryMonthDay(dateKey?: string) {
  if (!dateKey || dateKey === "unknown") return { month: "--", day: "--" }
  const [, month, day] = dateKey.split("-")
  return { month: `${month}月`, day: day ?? "--" }
}

function diaryWeekday(dateKey?: string) {
  if (!dateKey || dateKey === "unknown") return ""
  const date = parseDate(`${dateKey}T00:00:00`)
  if (!date) return ""
  return formatLocalWeekday(date)
}

function diaryDateStamp(value?: string | null) {
  const key = diaryDateKey(value)
  return {
    key,
    title: diaryDateTitle(key),
    weekday: diaryWeekday(key),
    ...diaryMonthDay(key),
  }
}

function ensureExpanded(list: string[], value?: string) {
  if (!value || list.includes(value)) return list
  return [...list, value]
}

function toggleExpanded(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

function mergeRuns(existing: ApiSelfAwakeRun[], incoming: ApiSelfAwakeRun[]) {
  const seen = new Set(existing.map((run) => run.id))
  return [...existing, ...incoming.filter((run) => !seen.has(run.id))]
}

function formatMinutes(minutes?: number | null) {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "未安排"
  if (minutes < 60) return `${minutes} 分钟后`
  const hours = minutes / 60
  if (Number.isInteger(hours)) return `${hours} 小时后`
  return `${hours.toFixed(1)} 小时后`
}

function trimText(value?: string | null, fallback = "未记录") {
  const text = value?.trim()
  return text || fallback
}

function stringifyCompact(value: unknown) {
  if (value === null || value === undefined || value === "") return "无"
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value)
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function knownContextItems(run?: ApiSelfAwakeRun) {
  const context = run?.context_payload
  if (!context) return []

  const preferred: Array<[string, keyof typeof context | string]> = [
    ["触发", "trigger"],
    ["来源", "source_service"],
    ["时间", "current_time"],
    ["活动", "user_activity"],
  ]
  const items = preferred
    .map(([label, key]) => [label, context[key]] as const)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")

  if (items.length) return items

  return Object.entries(context)
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 4)
    .map(([key, value]) => [key, value] as const)
}

function resolveDiary(run?: ApiSelfAwakeRun) {
  return run?.diaries?.find((diary) => diary.visible_to_user) ?? run?.diaries?.[0]
}

function resolveAction(run?: ApiSelfAwakeRun): ApiSelfAwakeAction | undefined {
  return run?.actions?.[0]
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone = "muted",
}: {
  icon: typeof Clock3
  label: string
  value: string
  tone?: StatusTone
}) {
  return (
    <div className="min-w-0 rounded-[1.2vh] border border-border bg-card px-[1.2vw] py-[1.4vh] shadow-sm">
      <div className="flex items-center gap-[0.7vw] text-[1.55vh] text-text-muted">
        <span className={`flex h-[3vh] w-[3vh] items-center justify-center rounded-[0.8vh] border ${toneClass(tone)}`}>
          <Icon className="h-[1.7vh] w-[1.7vh]" />
        </span>
        <span>{label}</span>
      </div>
      <div className="mt-[0.9vh] truncate font-serif text-[2.45vh] text-text">{value}</div>
    </div>
  )
}

export function SelfAwakePage({ currentUser, assistant, toolStatus, onBack }: SelfAwakePageProps) {
  const [runs, setRuns] = useState<ApiSelfAwakeRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<number | undefined>()
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalRuns, setTotalRuns] = useState(0)
  const [activeView, setActiveView] = useState<SelfAwakeView>("overview")
  const [expandedDiaryYears, setExpandedDiaryYears] = useState<string[]>([])
  const [expandedDiaryMonths, setExpandedDiaryMonths] = useState<string[]>([])
  const [expandedDiaryDates, setExpandedDiaryDates] = useState<string[]>([])
  const [diarySearch, setDiarySearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const searchQuery = diarySearch.trim()

  const loadRuns = useCallback(async (page = 1, append = false) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError(undefined)
    try {
      const pageData = await listSelfAwakeRunsPage({ page, pageSize: selfAwakePageSize, q: searchQuery })
      setCurrentPage(pageData.current_page)
      setTotalPages(pageData.total_pages)
      setTotalRuns(pageData.count)
      setRuns((currentRuns) => {
        const nextRuns = append ? mergeRuns(currentRuns, pageData.results) : pageData.results
        setSelectedRunId((current) => {
          if (current && nextRuns.some((run) => run.id === current)) return current
          return nextRuns[0]?.id
        })
        return nextRuns
      })
    } catch (loadError) {
      setError(getErrorMessage(loadError, "读取自醒记录失败。"))
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [searchQuery])

  useEffect(() => {
    void loadRuns()
  }, [loadRuns])

  const selectedRun = useMemo(() => runs.find((run) => run.id === selectedRunId) ?? runs[0], [runs, selectedRunId])
  const latestRun = runs[0]
  const hasMoreRuns = currentPage < totalPages
  const selectedDiary = resolveDiary(selectedRun)
  const selectedAction = resolveAction(selectedRun)
  const searchOnline = toolStatus?.search.status === "online"
  const contextItems = knownContextItems(selectedRun)
  const assistantName = assistant?.name || "默认助手"
  const normalizedDiarySearch = searchQuery.toLowerCase()
  const allDiaryEntries = useMemo(
    () =>
      runs
        .flatMap((run) =>
          (run.diaries ?? [])
            .filter((diary) => diary.visible_to_user)
            .map((diary) => {
              const timestamp = diaryTimestamp(run, diary)
              return {
                run,
                diary,
                timestamp,
                dateKey: diaryDateKey(timestamp),
              }
            }),
        )
        .sort((left, right) => dateMillis(right.timestamp) - dateMillis(left.timestamp)),
    [runs],
  )
  const diaryEntries = allDiaryEntries
  const diaryGroups = useMemo(() => {
    const groups = new Map<string, DiaryEntry[]>()
    for (const entry of diaryEntries) {
      groups.set(entry.dateKey, [...(groups.get(entry.dateKey) ?? []), entry])
    }
    return Array.from(groups.entries())
      .map(([dateKey, entries]) => ({
        dateKey,
        entries,
        count: entries.length,
        latestTimestamp: entries[0]?.timestamp,
      }))
      .sort((left, right) => dateMillis(right.latestTimestamp) - dateMillis(left.latestTimestamp))
  }, [diaryEntries])
  const diaryYears = useMemo<DiaryYearGroup[]>(() => {
    const yearMap = new Map<string, Map<string, DiaryDayGroup[]>>()

    for (const day of diaryGroups) {
      const yearKey = diaryYearKey(day.dateKey)
      const monthKey = diaryMonthKey(day.dateKey)
      const monthMap = yearMap.get(yearKey) ?? new Map<string, DiaryDayGroup[]>()
      monthMap.set(monthKey, [...(monthMap.get(monthKey) ?? []), day])
      yearMap.set(yearKey, monthMap)
    }

    return Array.from(yearMap.entries())
      .map(([yearKey, monthMap]) => {
        const months = Array.from(monthMap.entries())
          .map(([monthKey, days]) => ({
            monthKey,
            days,
            count: days.reduce((sum, day) => sum + day.count, 0),
            latestTimestamp: days[0]?.latestTimestamp,
          }))
          .sort((left, right) => dateMillis(right.latestTimestamp) - dateMillis(left.latestTimestamp))

        return {
          yearKey,
          months,
          count: months.reduce((sum, month) => sum + month.count, 0),
          latestTimestamp: months[0]?.latestTimestamp,
        }
      })
      .sort((left, right) => dateMillis(right.latestTimestamp) - dateMillis(left.latestTimestamp))
  }, [diaryGroups])

  const openDiaryPath = useCallback((dateKey?: string) => {
    if (!dateKey || dateKey === "unknown") return
    setExpandedDiaryYears((current) => ensureExpanded(current, diaryYearKey(dateKey)))
    setExpandedDiaryMonths((current) => ensureExpanded(current, diaryMonthKey(dateKey)))
    setExpandedDiaryDates((current) => ensureExpanded(current, dateKey))
  }, [])

  useEffect(() => {
    if (!diaryGroups.length) {
      setExpandedDiaryYears([])
      setExpandedDiaryMonths([])
      setExpandedDiaryDates([])
      return
    }
    const latestDate = diaryGroups[0]?.dateKey
    const latestYear = diaryYearKey(latestDate)
    const latestMonth = diaryMonthKey(latestDate)
    const validYears = new Set(diaryYears.map((year) => year.yearKey))
    const validMonths = new Set(diaryYears.flatMap((year) => year.months.map((month) => month.monthKey)))
    const validDates = new Set(diaryGroups.map((group) => group.dateKey))

    setExpandedDiaryYears((current) => {
      const next = current.filter((item) => validYears.has(item))
      return next.length ? next : latestYear === "unknown" ? next : [latestYear]
    })
    setExpandedDiaryMonths((current) => {
      const next = current.filter((item) => validMonths.has(item))
      return next.length ? next : latestMonth === "unknown" ? next : [latestMonth]
    })
    setExpandedDiaryDates((current) => {
      const next = current.filter((item) => validDates.has(item))
      return next.length ? next : latestDate && latestDate !== "unknown" ? [latestDate] : next
    })
  }, [diaryGroups])

  useEffect(() => {
    if (!selectedDiary || activeView !== "diary") return
    const key = diaryDateKey(selectedDiary.created_at ?? selectedRun?.finished_at)
    if (key !== "unknown") {
      openDiaryPath(key)
    }
  }, [activeView, openDiaryPath, selectedDiary, selectedRun?.finished_at])

  return (
    <motion.div
      key="self-awake"
      {...screenMotion}
      transition={transition}
      className="fixed inset-0 z-10 flex h-[100vh] w-[100vw] flex-col overflow-hidden bg-bg bg-cover bg-center font-sans text-text"
      style={{
        backgroundImage: `linear-gradient(rgba(245, 245, 244, 0.56), rgba(245, 245, 244, 0.56)), url(${journalWorkspaceBackground})`,
      }}
    >
      <header className="flex h-[11vh] items-center justify-between border-b border-white/45 bg-bg/70 px-[2.8vw] shadow-sm backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-[1.2vw]">
          <button
            type="button"
            onClick={onBack}
            className="rounded-[1vh] p-[1.15vh] text-text-muted transition-colors hover:bg-card hover:text-text"
            aria-label="返回聊天"
            title="返回聊天"
          >
            <ArrowLeft className="h-[2.7vh] w-[2.7vh]" />
          </button>
          <div className="flex h-[5.7vh] w-[5.7vh] items-center justify-center rounded-[1.2vh] border border-accent/25 bg-card text-accent shadow-sm">
            <Sparkles className="h-[2.7vh] w-[2.7vh]" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-serif text-[3.15vh] text-text">自醒</h1>
            <p className="truncate text-[1.65vh] text-text-muted">后台观察、工作日记、下次醒来。</p>
          </div>
        </div>
        <div className="flex items-center gap-[0.8vw]">
          <div className="flex rounded-full border border-border bg-card p-[0.45vh] shadow-sm">
            {[
              { key: "overview" as const, label: "概览", icon: Sparkles },
              { key: "diary" as const, label: "日记", icon: BookOpenText },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setActiveView(item.key)
                  if (item.key === "overview" && diarySearch) setDiarySearch("")
                }}
                className={`flex items-center gap-[0.45vw] rounded-full px-[1vw] py-[0.7vh] text-[1.55vh] transition-colors ${
                  activeView === item.key ? "bg-accent text-white shadow-sm" : "text-text-muted hover:bg-bg hover:text-accent"
                }`}
              >
                <item.icon className="h-[1.8vh] w-[1.8vh]" />
                {item.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void loadRuns()}
            className="flex items-center gap-[0.5vw] rounded-full border border-border bg-card px-[1.1vw] py-[1vh] text-[1.55vh] text-text-muted shadow-sm transition-colors hover:border-accent/35 hover:text-accent"
            title="刷新自醒记录"
          >
            <RefreshCw className={`h-[1.9vh] w-[1.9vh] ${loading ? "animate-spin" : ""}`} />
            刷新
          </button>
          <div className="rounded-full border border-border bg-card px-[1.2vw] py-[1vh] text-[1.55vh] text-text-muted shadow-sm">
            {currentUser?.username ?? "未登录"}
          </div>
        </div>
      </header>

      {activeView === "overview" ? (
        <main className="grid min-h-0 flex-1 grid-rows-[12.5vh_minmax(0,1fr)] gap-[1.8vh] overflow-hidden p-[2vw]">
          <section className="grid min-h-0 grid-cols-4 gap-[1.2vw]">
            <SummaryCard
              icon={Clock3}
              label="最近醒来"
              value={formatDateTime(latestRun?.finished_at ?? latestRun?.created_at)}
              tone={latestRun ? (statusMeta[latestRun.status]?.tone ?? "muted") : "muted"}
            />
            <SummaryCard
              icon={TimerReset}
              label="下次醒来"
              value={latestRun?.next_wake_at ? formatDateTime(latestRun.next_wake_at) : formatMinutes(latestRun?.next_wake_after_minutes)}
              tone="warn"
            />
            <SummaryCard
              icon={Bell}
              label="通知用户"
              value={latestRun?.should_interrupt_user ? "需要提醒" : "保持安静"}
              tone={latestRun?.should_interrupt_user ? "warn" : "ok"}
            />
            <SummaryCard
              icon={CircleDot}
              label="联网工具"
              value={searchOnline ? "可用" : "未确认"}
              tone={searchOnline ? "ok" : "muted"}
            />
          </section>

          <section className="grid min-h-0 grid-cols-[32vw_minmax(0,1fr)] gap-[1.6vw] overflow-hidden">
          <aside className="flex min-h-0 flex-col overflow-hidden rounded-[1.4vh] border border-border bg-card shadow-sm">
            <div className="flex h-[7.2vh] items-center justify-between border-b border-border px-[1.4vw]">
              <div>
                <div className="font-serif text-[2.55vh] text-text">自醒记录</div>
                <div className="text-[1.45vh] text-text-muted">
                  {loading ? "正在读取" : totalRuns ? `已加载 ${runs.length} / ${totalRuns} 次` : `${runs.length} 次记录`}
                </div>
              </div>
              {error ? <AlertCircle className="h-[2.4vh] w-[2.4vh] text-red-500" /> : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-scroll" style={{ scrollbarGutter: "stable" }}>
              <div className="p-[1vh] pr-[2.4vh]">
                {error ? (
                  <div className="rounded-[1.1vh] border border-red-200 bg-red-50 p-[1.4vh] text-[1.75vh] leading-relaxed text-red-700">
                    {error}
                  </div>
                ) : null}

                {!loading && !error && runs.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-center text-text-muted">
                    <Sparkles className="mb-[1.2vh] h-[4vh] w-[4vh] text-accent/70" />
                    <div className="font-serif text-[2.3vh] text-text">还没有自醒记录</div>
                    <div className="mt-[0.8vh] max-w-[22vw] text-[1.65vh] leading-relaxed">
                      Agent 启动自醒或定时自醒完成后，会显示在这里。
                    </div>
                  </div>
                ) : null}

                <div className="space-y-[1vh]">
                  {runs.map((run) => {
                    const selected = run.id === selectedRun?.id
                    const meta = statusMeta[run.status] ?? { label: run.status || "未知", tone: "muted" as const }
                    const diary = resolveDiary(run)
                    return (
                      <button
                        key={run.id}
                        type="button"
                        onClick={() => setSelectedRunId(run.id)}
                        className={`w-full rounded-[1.1vh] border p-[1.3vh] text-left transition-colors ${
                          selected
                            ? "border-accent/55 bg-accent-dim shadow-sm"
                            : "border-border bg-bg hover:border-accent/30 hover:bg-card"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-[0.8vw]">
                          <div className="truncate font-serif text-[2.1vh] text-text">{diary?.title || "一次自醒"}</div>
                          <span className={`shrink-0 rounded-full border px-[0.6vw] py-[0.35vh] text-[1.25vh] ${toneClass(meta.tone)}`}>
                            {meta.label}
                          </span>
                        </div>
                        <div className="mt-[0.6vh] flex items-center justify-between text-[1.45vh] text-text-muted">
                          <span>{formatDateTime(run.finished_at ?? run.created_at)}</span>
                          <span>{run.source_service || "monagent"}</span>
                        </div>
                        <div className="mt-[0.7vh] line-clamp-2 text-[1.55vh] leading-relaxed text-text-muted">
                          {trimText(run.current_desire || diary?.content, "没有留下想法。")}
                        </div>
                      </button>
                    )
                  })}
                  {!loading && !error && hasMoreRuns ? (
                    <button
                      type="button"
                      onClick={() => void loadRuns(currentPage + 1, true)}
                      disabled={loadingMore}
                      className="flex w-full items-center justify-center gap-[0.55vw] rounded-[1vh] border border-dashed border-border bg-bg px-[1vw] py-[1.1vh] text-[1.55vh] text-text-muted transition-colors hover:border-accent/35 hover:text-accent disabled:cursor-wait disabled:opacity-60"
                    >
                      <RefreshCw className={`h-[1.75vh] w-[1.75vh] ${loadingMore ? "animate-spin" : ""}`} />
                      {loadingMore ? "正在加载" : "加载更多"}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </aside>

          <section className="min-h-0 overflow-hidden rounded-[1.4vh] border border-border bg-card shadow-sm">
            {selectedRun ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="min-h-0 flex-1 overflow-y-scroll" style={{ scrollbarGutter: "stable" }}>
                  <div className="p-[1.6vw] pr-[2.8vw]">
                    <div className="grid grid-cols-4 gap-[1vw]">
                    <div className="rounded-[1vh] border border-border bg-bg p-[1.2vh]">
                      <div className="text-[1.35vh] text-text-muted">执行身份</div>
                      <div className="mt-[0.6vh] truncate text-[1.85vh] text-text">{assistantName}</div>
                    </div>
                    <div className="rounded-[1vh] border border-border bg-bg p-[1.2vh]">
                      <div className="text-[1.35vh] text-text-muted">状态</div>
                      <div className="mt-[0.6vh] truncate text-[1.9vh] text-text">{trimText(selectedRun.mood, "平稳")}</div>
                    </div>
                    <div className="rounded-[1vh] border border-border bg-bg p-[1.2vh]">
                      <div className="text-[1.35vh] text-text-muted">下次</div>
                      <div className="mt-[0.6vh] truncate text-[1.9vh] text-text">
                        {formatDateTime(selectedRun.next_wake_at)}
                      </div>
                    </div>
                    <div className="rounded-[1vh] border border-border bg-bg p-[1.2vh]">
                      <div className="text-[1.35vh] text-text-muted">间隔</div>
                      <div className="mt-[0.6vh] truncate text-[1.9vh] text-text">
                        {formatMinutes(selectedRun.next_wake_after_minutes)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-[1.5vh] grid grid-cols-[1fr_0.92fr] gap-[1.2vw]">
                    <div className="space-y-[1.2vh]">
                      <DetailBlock icon={Sparkles} title="观察">
                        {contextItems.length ? (
                          <div className="grid gap-[0.8vh]">
                            {contextItems.map(([label, value]) => (
                              <div key={label} className="grid grid-cols-[5.2vw_1fr] gap-[0.8vw] text-[1.65vh] leading-relaxed">
                                <span className="text-text-muted">{label}</span>
                                <span className="text-text">{stringifyCompact(value)}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-text-muted">没有保存观察上下文。</p>
                        )}
                      </DetailBlock>

                      <DetailBlock icon={NotebookText} title="工作日记">
                        <p className="whitespace-pre-wrap text-[1.8vh] leading-relaxed text-text">
                          {trimText(selectedDiary?.content, "没有写入日记。")}
                        </p>
                      </DetailBlock>
                    </div>

                    <div className="space-y-[1.2vh]">
                      <DetailBlock icon={CheckCircle2} title="当前想法">
                        <p className="whitespace-pre-wrap text-[1.8vh] leading-relaxed text-text">
                          {trimText(selectedRun.current_desire, "没有留下明确想法。")}
                        </p>
                      </DetailBlock>

                      <DetailBlock icon={CalendarClock} title="动作">
                        <div className="space-y-[0.9vh] text-[1.7vh] leading-relaxed">
                          <div className="flex items-center justify-between rounded-[0.9vh] border border-border bg-bg px-[1vw] py-[1vh]">
                            <span>{actionLabels[selectedAction?.action_type || ""] || selectedAction?.action_type || "未记录"}</span>
                            <span className="text-text-muted">{selectedAction?.status || "none"}</span>
                          </div>
                          {selectedAction?.message ? <p className="text-text-muted">{selectedAction.message}</p> : null}
                          {selectedRun.next_wake_reason ? (
                            <p className="text-text-muted">下次原因：{selectedRun.next_wake_reason}</p>
                          ) : null}
                          {selectedRun.error || selectedAction?.error ? (
                            <p className="rounded-[0.9vh] border border-red-200 bg-red-50 p-[1vh] text-red-700">
                              {selectedRun.error || selectedAction?.error}
                            </p>
                          ) : null}
                        </div>
                      </DetailBlock>
                    </div>
                  </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center text-text-muted">
                <NotebookText className="mb-[1.2vh] h-[4.6vh] w-[4.6vh] text-accent/70" />
                <div className="font-serif text-[2.6vh] text-text">等待第一次自醒</div>
                <div className="mt-[0.7vh] text-[1.75vh]">这里会显示她后台醒来后的记录。</div>
              </div>
            )}
          </section>
          </section>
        </main>
      ) : (
        <main className="grid min-h-0 flex-1 grid-cols-[33vw_minmax(0,1fr)] gap-[1.6vw] overflow-hidden p-[2vw]">
          <aside className="flex min-h-0 flex-col overflow-hidden rounded-[1.4vh] border border-white/55 bg-card/68 shadow-[0_1vh_3vh_rgba(48,36,24,0.10)] backdrop-blur-[3px]">
            <div className="flex h-[7.2vh] items-center justify-between border-b border-white/45 px-[1.4vw]">
              <div>
                <div className="font-serif text-[2.55vh] text-text">手帐目录</div>
                <div className="text-[1.45vh] text-text-muted">
                  {loading
                    ? "正在读取"
                    : normalizedDiarySearch
                      ? `匹配 ${totalRuns} 篇 · 已加载 ${diaryEntries.length} 篇`
                      : totalRuns
                        ? `${diaryYears.length} 年 · ${diaryGroups.length} 天 · ${diaryEntries.length} / ${totalRuns} 篇`
                        : `${diaryYears.length} 年 · ${diaryGroups.length} 天 · ${diaryEntries.length} 篇`}
                </div>
              </div>
              <BookOpenText className="h-[2.5vh] w-[2.5vh] text-accent" />
            </div>

            <div className="min-h-0 flex-1 overflow-y-scroll" style={{ scrollbarGutter: "stable" }}>
              <div className="p-[1vh] pr-[2.4vh]">
                <div className="mb-[0.9vh] flex h-[4.6vh] items-center gap-[0.65vw] rounded-[1vh] border border-[#eadfcf]/80 bg-[#fffdf8]/72 px-[0.85vw] shadow-sm backdrop-blur-[1px] focus-within:border-accent/55 focus-within:ring-2 focus-within:ring-accent/10">
                  <Search className="h-[1.9vh] w-[1.9vh] shrink-0 text-accent" />
                  <input
                    value={diarySearch}
                    onChange={(event) => setDiarySearch(event.target.value)}
                    placeholder="搜索标题、正文或日期"
                    className="min-w-0 flex-1 bg-transparent text-[1.55vh] text-text outline-none placeholder:text-text-muted/70"
                  />
                  {diarySearch ? (
                    <button
                      type="button"
                      onClick={() => setDiarySearch("")}
                      className="rounded-full p-[0.35vh] text-text-muted transition-colors hover:bg-accent-dim hover:text-accent"
                      aria-label="清空搜索"
                      title="清空搜索"
                    >
                      <X className="h-[1.75vh] w-[1.75vh]" />
                    </button>
                  ) : null}
                </div>
                <div className="mb-[0.8vh] flex items-center gap-[0.6vw] px-[0.3vw] text-[1.45vh] text-text-muted">
                  <CalendarDays className="h-[1.8vh] w-[1.8vh]" />
                  按年 / 月 / 日展开
                </div>
                {error ? (
                  <div className="rounded-[1.1vh] border border-red-200 bg-red-50 p-[1.4vh] text-[1.75vh] leading-relaxed text-red-700">
                    {error}
                  </div>
                ) : null}
                {!loading && !error && allDiaryEntries.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-center text-text-muted">
                    <NotebookText className="mb-[1.2vh] h-[4vh] w-[4vh] text-accent/70" />
                    <div className="font-serif text-[2.3vh] text-text">还没有日记</div>
                    <div className="mt-[0.8vh] max-w-[20vw] text-[1.65vh] leading-relaxed">
                      自醒完成并写入工作日记后，会出现在这里。
                    </div>
                  </div>
                ) : null}
                {!loading && !error && allDiaryEntries.length > 0 && diaryEntries.length === 0 ? (
                  <div className="mt-[2vh] rounded-[1.1vh] border border-dashed border-[#eadfcf]/80 bg-[#fffdf8]/72 p-[1.6vh] text-center backdrop-blur-[1px]">
                    <Search className="mx-auto mb-[0.9vh] h-[3.4vh] w-[3.4vh] text-accent/70" />
                    <div className="font-serif text-[2.05vh] text-text">没有找到日记</div>
                    <div className="mt-[0.55vh] text-[1.5vh] text-text-muted">换个关键词试试。</div>
                  </div>
                ) : null}
                <div className="space-y-[0.95vh]">
                  {diaryYears.map((year) => {
                    const yearExpanded = expandedDiaryYears.includes(year.yearKey)
                    return (
                      <div key={year.yearKey} className="rounded-[1.2vh]">
                        <button
                          type="button"
                          onClick={() => setExpandedDiaryYears((current) => toggleExpanded(current, year.yearKey))}
                          className={`grid w-full grid-cols-[1fr_auto_2.4vh] items-center gap-[0.8vw] rounded-[1.1vh] border px-[1vw] py-[1.05vh] text-left transition-colors ${treeNodeClass(yearExpanded, "year")}`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-serif text-[2.3vh] text-text">{diaryYearTitle(year.yearKey)}</span>
                            <span className="block text-[1.35vh] text-text-muted">{year.months.length} 个月</span>
                          </span>
                          <span className="rounded-full border border-border bg-card px-[0.75vw] py-[0.42vh] text-[1.35vh] text-text-muted">
                            {year.count} 篇
                          </span>
                          <ChevronDown className={`h-[2vh] w-[2vh] text-text-muted transition-transform ${yearExpanded ? "rotate-180" : ""}`} />
                        </button>

                        {yearExpanded ? (
                          <div className="mt-[0.8vh] space-y-[0.8vh] border-l border-dashed border-accent/25 pl-[0.75vw]">
                            {year.months.map((month) => {
                              const monthExpanded = expandedDiaryMonths.includes(month.monthKey)
                              return (
                                <div key={month.monthKey}>
                                  <button
                                    type="button"
                                    onClick={() => setExpandedDiaryMonths((current) => toggleExpanded(current, month.monthKey))}
                                    className={`grid w-full grid-cols-[4.4vh_1fr_auto_2.2vh] items-center gap-[0.75vw] rounded-[1vh] border px-[0.85vw] py-[0.9vh] text-left transition-colors ${treeNodeClass(monthExpanded, "month")}`}
                                  >
                                    <span className="flex h-[4.4vh] w-[4.4vh] items-center justify-center rounded-[0.9vh] bg-accent-dim font-serif text-[1.8vh] text-accent">
                                      {diaryMonthTitle(month.monthKey).replace(" 月", "")}
                                    </span>
                                    <span className="min-w-0">
                                      <span className="block truncate font-serif text-[1.95vh] text-text">{diaryMonthTitle(month.monthKey)}</span>
                                      <span className="block text-[1.3vh] text-text-muted">{month.days.length} 天</span>
                                    </span>
                                    <span className="rounded-full border border-border bg-card px-[0.65vw] py-[0.35vh] text-[1.25vh] text-text-muted">
                                      {month.count} 篇
                                    </span>
                                    <ChevronDown className={`h-[1.85vh] w-[1.85vh] text-text-muted transition-transform ${monthExpanded ? "rotate-180" : ""}`} />
                                  </button>

                                  {monthExpanded ? (
                                    <div className="mt-[0.7vh] space-y-[0.7vh] border-l border-dashed border-accent/20 pl-[0.75vw]">
                                      {month.days.map((day) => {
                                        const dayExpanded = expandedDiaryDates.includes(day.dateKey)
                                        const date = diaryMonthDay(day.dateKey)
                                        return (
                                          <div key={day.dateKey}>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setExpandedDiaryDates((current) => toggleExpanded(current, day.dateKey))
                                                if (!dayExpanded) setSelectedRunId(day.entries[0]?.run.id)
                                              }}
                                              className={`grid w-full grid-cols-[4.8vh_1fr_auto_2vh] items-center gap-[0.72vw] rounded-[1vh] border px-[0.75vw] py-[0.8vh] text-left transition-colors ${treeNodeClass(dayExpanded, "day")}`}
                                            >
                                              <span className="flex h-[4.8vh] w-[4.8vh] flex-col items-center justify-center rounded-[0.9vh] bg-card font-serif shadow-sm">
                                                <span className="text-[1.05vh] text-text-muted">{date.month}</span>
                                                <span className="text-[2.05vh] leading-none text-text">{date.day}</span>
                                              </span>
                                              <span className="min-w-0">
                                                <span className="block truncate font-serif text-[1.82vh] text-text">{diaryDateTitle(day.dateKey)}</span>
                                                <span className="block text-[1.25vh] text-text-muted">{diaryWeekday(day.dateKey)}</span>
                                              </span>
                                              <span className="rounded-full border border-border bg-card px-[0.6vw] py-[0.32vh] text-[1.2vh] text-text-muted">
                                                {day.count} 篇
                                              </span>
                                              <ChevronDown className={`h-[1.75vh] w-[1.75vh] text-text-muted transition-transform ${dayExpanded ? "rotate-180" : ""}`} />
                                            </button>

                                            {dayExpanded ? (
                                              <div className="mt-[0.65vh] space-y-[0.65vh] border-l border-dashed border-accent/35 pl-[0.75vw]">
                                                {day.entries.map(({ run, diary, timestamp }) => {
                                                  const selected = run.id === selectedRun?.id && diary.id === selectedDiary?.id
                                                  return (
                                                    <button
                                                      key={`${run.id}-${diary.id}`}
                                                      type="button"
                                                      onClick={() => {
                                                        openDiaryPath(day.dateKey)
                                                        setSelectedRunId(run.id)
                                                      }}
                                                      className={`w-full rounded-[1vh] border-l-[0.32vw] p-[1.05vh] text-left transition-colors ${
                                                        selected
                                                          ? "border-accent bg-card/82 shadow-sm ring-1 ring-accent/15 backdrop-blur-[1px]"
                                                          : "border-transparent bg-bg/58 backdrop-blur-[1px] hover:border-accent/25 hover:bg-card/76"
                                                      }`}
                                                    >
                                                      <div className="truncate font-serif text-[1.92vh] text-text">{diary.title || "一次自醒"}</div>
                                                      <div className="mt-[0.45vh] text-[1.28vh] text-text-muted">{formatDateTime(timestamp)}</div>
                                                      <div className="mt-[0.65vh] line-clamp-2 text-[1.46vh] leading-relaxed text-text-muted">
                                                        {trimText(diary.summary || diary.content, "没有内容。")}
                                                      </div>
                                                    </button>
                                                  )
                                                })}
                                              </div>
                                            ) : null}
                                          </div>
                                        )
                                      })}
                                    </div>
                                  ) : null}
                                </div>
                              )
                            })}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                  {!loading && !error && hasMoreRuns ? (
                    <button
                      type="button"
                      onClick={() => void loadRuns(currentPage + 1, true)}
                      disabled={loadingMore}
                      className="flex w-full items-center justify-center gap-[0.55vw] rounded-[1vh] border border-dashed border-[#eadfcf]/80 bg-[#fffdf8]/72 px-[1vw] py-[1.1vh] text-[1.55vh] text-text-muted transition-colors hover:border-accent/35 hover:text-accent disabled:cursor-wait disabled:opacity-60"
                    >
                      <RefreshCw className={`h-[1.75vh] w-[1.75vh] ${loadingMore ? "animate-spin" : ""}`} />
                      {loadingMore ? "正在加载" : "加载更多"}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </aside>

          <section
            className="min-h-0 overflow-hidden rounded-[1.2vh] border border-[#eadfcf]/75 bg-[#fffdf8]/64 shadow-[0_1.2vh_3.5vh_rgba(48,36,24,0.08)] backdrop-blur-[2px]"
            style={{
              backgroundImage: `linear-gradient(rgba(255, 253, 248, 0.46), rgba(255, 253, 248, 0.46)), url(${diaryPaperTexture})`,
              backgroundPosition: "center",
              backgroundSize: "cover",
            }}
          >
            {selectedRun && selectedDiary ? (
              <div className="h-full min-h-0 overflow-y-scroll" style={{ scrollbarGutter: "stable" }}>
                <div className="px-[1.2vw] py-[1.4vh] pr-[2.4vw]">
                  <article
                    className="relative mx-auto max-w-[58vw] overflow-hidden px-[3vw] py-[3.2vh]"
                  >
                    <div className="pointer-events-none absolute right-[2.4vw] top-[2.4vh] rotate-[-5deg] rounded-[999px] border border-emerald-200 bg-emerald-50/70 px-[0.9vw] py-[0.55vh] font-serif text-[1.45vh] text-emerald-700">
                      完成
                    </div>

                    <div className="mb-[2.4vh] flex items-start gap-[1.2vw] border-b border-dashed border-[#ddd2c1] pb-[1.8vh] pr-[5.6vw]">
                      <div className="flex h-[7.2vh] w-[5.6vh] shrink-0 flex-col items-center justify-center rounded-[0.9vh] border border-[#eadfcf]/85 bg-white/72 font-serif shadow-sm backdrop-blur-[1px]">
                        <span className="text-[1.12vh] text-text-muted">{diaryDateStamp(selectedDiary.created_at ?? selectedRun.finished_at).month}</span>
                        <span className="text-[2.55vh] leading-none text-text">{diaryDateStamp(selectedDiary.created_at ?? selectedRun.finished_at).day}</span>
                      </div>
                      <div className="min-w-0 pt-[0.15vh]">
                        <div className="mb-[0.35vh] flex flex-wrap items-center gap-x-[0.7vw] gap-y-[0.35vh] text-[1.45vh] text-text-muted">
                          <span className="inline-flex items-center gap-[0.35vw]">
                            <CalendarDays className="h-[1.65vh] w-[1.65vh] text-accent" />
                            {diaryDateStamp(selectedDiary.created_at ?? selectedRun.finished_at).title}
                          </span>
                          <span>{diaryDateStamp(selectedDiary.created_at ?? selectedRun.finished_at).weekday}</span>
                        </div>
                        <h2 className="font-serif text-[3.05vh] leading-tight text-text">{selectedDiary.title || "一次自醒"}</h2>
                        <div className="mt-[0.7vh] flex flex-wrap items-center gap-x-[0.75vw] gap-y-[0.35vh] text-[1.48vh] text-text-muted">
                          <span>{assistantName} 写于 {formatDateTime(selectedDiary.created_at ?? selectedRun.finished_at)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="border-l-[0.18vw] border-accent/35 pl-[1.35vw]">
                      <div
                        className="overflow-y-auto pr-[0.9vw]"
                        style={{
                          minHeight: "calc(2.12vh * 2.05 * 6)",
                          maxHeight: "calc(2.12vh * 2.05 * 6)",
                          scrollbarGutter: "stable",
                        }}
                      >
                        <p className="whitespace-pre-wrap font-serif text-[2.12vh] leading-[2.05] text-text">
                          {trimText(selectedDiary.content, "没有写入日记。")}
                        </p>
                      </div>
                    </div>

                    <div className="mt-[2.6vh] flex flex-wrap gap-[0.8vw] border-t border-dashed border-[#ddd2c1] pt-[1.7vh] text-[1.48vh]">
                      <div className="rounded-[0.9vh] border border-[#eadfcf]/85 bg-white/62 px-[0.9vw] py-[0.75vh] shadow-sm backdrop-blur-[1px]">
                        <span className="mr-[0.45vw] text-text-muted">状态</span>
                        <span className="text-text">{trimText(selectedRun.mood, "平稳")}</span>
                      </div>
                      <div className="rounded-[0.9vh] border border-[#eadfcf]/85 bg-white/62 px-[0.9vw] py-[0.75vh] shadow-sm backdrop-blur-[1px]">
                        <span className="mr-[0.45vw] text-text-muted">下次醒来</span>
                        <span className="text-text">
                          {selectedRun.next_wake_at ? formatDateTime(selectedRun.next_wake_at) : formatMinutes(selectedRun.next_wake_after_minutes)}
                        </span>
                      </div>
                      <div className="rounded-[0.9vh] border border-[#eadfcf]/85 bg-white/62 px-[0.9vw] py-[0.75vh] shadow-sm backdrop-blur-[1px]">
                        <span className="mr-[0.45vw] text-text-muted">安排</span>
                        <span className="text-text">
                          {actionLabels[selectedAction?.action_type || ""] || selectedAction?.action_type || "未记录"}
                        </span>
                      </div>
                    </div>
                  </article>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center text-text-muted">
                <NotebookText className="mb-[1.2vh] h-[4.6vh] w-[4.6vh] text-accent/70" />
                <div className="font-serif text-[2.6vh] text-text">选择一篇日记</div>
                <div className="mt-[0.7vh] text-[1.75vh]">自醒写下的内容会在这里展开。</div>
              </div>
            )}
          </section>
        </main>
      )}
    </motion.div>
  )
}

function DetailBlock({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Sparkles
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-[1.1vh] border border-border bg-bg p-[1.35vh]">
      <div className="mb-[1vh] flex items-center gap-[0.7vw]">
        <span className="flex h-[3.2vh] w-[3.2vh] items-center justify-center rounded-[0.8vh] bg-card text-accent">
          <Icon className="h-[1.8vh] w-[1.8vh]" />
        </span>
        <span className="font-serif text-[2.25vh] text-text">{title}</span>
      </div>
      <div className="text-[1.65vh]">{children}</div>
    </div>
  )
}
