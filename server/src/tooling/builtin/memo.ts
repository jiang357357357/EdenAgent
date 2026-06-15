import type { AgentTool } from "@earendil-works/pi-agent-core"
import { Type } from "@earendil-works/pi-ai"
import type { CoreMemo } from "../../core"
import { formatLocalDateTimeWithZone } from "../../shared/time"
import { formatMemoList, memoLine, memoWithLocalTime, memosWithLocalTime, normalizeMemoDate, requireCoreMemoAccess, text, withLocalMemoTime, type MonToolOptions } from "./shared"

export function createMemoTools(options: MonToolOptions = {}): AgentTool[] {
  return [
    {
      name: "create_memo",
      label: "创建备忘录",
      description: "在 MonCore 创建一条用户备忘录、待办或提醒。普通记录用 note，需要未来触发时用 reminder 或 todo。",
      parameters: Type.Object({
        title: Type.String({ description: "简短标题。" }),
        content: Type.Optional(Type.String({ description: "详细内容。" })),
        kind: Type.Optional(Type.String({ description: "类型：note、reminder 或 todo，默认 note。" })),
        priority: Type.Optional(Type.String({ description: "优先级：low、normal 或 high，默认 normal。" })),
        remind_at: Type.Optional(Type.String({ description: "提醒时间。可传带时区 ISO；若传普通日期时间字符串，将按本地时区解析。" })),
        due_at: Type.Optional(Type.String({ description: "截止时间。可传带时区 ISO；若传普通日期时间字符串，将按本地时区解析。" })),
        repeat_rule: Type.Optional(Type.String({ description: "重复规则，MVP 阶段可留空。" })),
        metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "扩展数据。" })),
      }),
      executionMode: "sequential",
      async execute(_toolCallID, rawInput) {
        const input = rawInput as {
          title: string
          content?: string
          kind?: CoreMemo["kind"]
          priority?: CoreMemo["priority"]
          remind_at?: string
          due_at?: string
          repeat_rule?: string
          metadata?: Record<string, unknown>
        }
        const { coreClient, coreToken } = requireCoreMemoAccess(options)
        const memo = await coreClient.createMemo(coreToken, {
          title: input.title,
          content: input.content ?? "",
          kind: input.kind ?? "note",
          priority: input.priority ?? "normal",
          remind_at: normalizeMemoDate(input.remind_at, "remind_at"),
          due_at: normalizeMemoDate(input.due_at, "due_at"),
          repeat_rule: input.repeat_rule ?? "",
          source: "monagent",
          related_session_id: options.sessionID ?? "",
          metadata: input.metadata ?? {},
        })
        return text(`已创建备忘录。\n\n${memoLine(memo)}`, withLocalMemoTime({ memo: memoWithLocalTime(memo) }))
      },
    },
    {
      name: "create_reminder",
      label: "创建提醒",
      description: "在 MonCore 创建一条会在指定时间触发的提醒。用户说“提醒我”时优先使用此工具。",
      parameters: Type.Object({
        title: Type.String({ description: "提醒标题。" }),
        remind_at: Type.String({ description: "提醒时间，必须明确。可传带时区 ISO；若传普通日期时间字符串，将按本地时区解析。" }),
        content: Type.Optional(Type.String({ description: "提醒详情。" })),
        priority: Type.Optional(Type.String({ description: "优先级：low、normal 或 high，默认 normal。" })),
        metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "扩展数据。" })),
      }),
      executionMode: "sequential",
      async execute(_toolCallID, rawInput) {
        const input = rawInput as {
          title: string
          remind_at: string
          content?: string
          priority?: CoreMemo["priority"]
          metadata?: Record<string, unknown>
        }
        const { coreClient, coreToken } = requireCoreMemoAccess(options)
        const memo = await coreClient.createMemo(coreToken, {
          title: input.title,
          content: input.content ?? "",
          kind: "reminder",
          priority: input.priority ?? "normal",
          remind_at: normalizeMemoDate(input.remind_at, "remind_at"),
          source: "monagent",
          related_session_id: options.sessionID ?? "",
          metadata: input.metadata ?? {},
        })
        return text(`已创建提醒。\n\n${memoLine(memo)}`, withLocalMemoTime({ memo: memoWithLocalTime(memo) }))
      },
    },
    {
      name: "list_memos",
      label: "查询备忘录",
      description: "查询当前用户的备忘录、提醒和待办，可按状态、类型、关键词筛选。",
      parameters: Type.Object({
        kind: Type.Optional(Type.String({ description: "类型筛选：note、reminder 或 todo。" })),
        status: Type.Optional(Type.String({ description: "状态筛选：active、done、archived 或 cancelled。" })),
        priority: Type.Optional(Type.String({ description: "优先级筛选：low、normal 或 high。" })),
        q: Type.Optional(Type.String({ description: "标题或正文关键词。" })),
        limit: Type.Optional(Type.Number({ description: "最多返回多少条，默认 20。" })),
      }),
      async execute(_toolCallID, rawInput) {
        const input = rawInput as { kind?: string; status?: string; priority?: string; q?: string; limit?: number }
        const { coreClient, coreToken } = requireCoreMemoAccess(options)
        const memos = await coreClient.listMemos(coreToken, {
          ...input,
          limit: Math.min(Math.max(Math.round(input.limit ?? 20), 1), 100),
        })
        return text(
          formatMemoList("备忘录查询结果：", memos),
          withLocalMemoTime({ memos: memosWithLocalTime(memos), count: memos.length }),
        )
      },
    },
    {
      name: "list_due_memos",
      label: "查询到期提醒",
      description: "兼容工具：查询当前时间之前应触发但尚未标记触发的提醒/待办。新的后台流程优先使用 dispatch_due_memos。",
      parameters: Type.Object({
        before: Type.Optional(Type.String({ description: "查询这个时间之前的到期项，默认当前时间。" })),
        limit: Type.Optional(Type.Number({ description: "最多返回多少条，默认 20。" })),
      }),
      async execute(_toolCallID, rawInput) {
        const input = rawInput as { before?: string; limit?: number }
        const { coreClient, coreToken } = requireCoreMemoAccess(options)
        const memos = await coreClient.listDueMemos(coreToken, {
          before: normalizeMemoDate(input.before, "before"),
          limit: Math.min(Math.max(Math.round(input.limit ?? 20), 1), 100),
        })
        return text(
          formatMemoList("到期提醒：", memos),
          withLocalMemoTime({ memos: memosWithLocalTime(memos), count: memos.length }),
        )
      },
    },
    {
      name: "dispatch_due_memos",
      label: "派发到期提醒",
      description:
        "按时间索引取出已到期且尚未派发的提醒/待办，并返回下一次应唤醒时间。后台自醒到点后优先调用此工具。",
      parameters: Type.Object({
        before: Type.Optional(Type.String({ description: "派发这个时间之前的到期项，默认当前时间。" })),
        limit: Type.Optional(Type.Number({ description: "最多派发多少条，默认 20。" })),
        mark_dispatched: Type.Optional(Type.Boolean({ description: "是否立即标记为已派发，默认 false。" })),
      }),
      executionMode: "sequential",
      async execute(_toolCallID, rawInput) {
        const input = rawInput as { before?: string; limit?: number; mark_dispatched?: boolean }
        const { coreClient, coreToken } = requireCoreMemoAccess(options)
        const result = await coreClient.dispatchDueMemos(coreToken, {
          before: normalizeMemoDate(input.before, "before"),
          limit: Math.min(Math.max(Math.round(input.limit ?? 20), 1), 100),
          mark_dispatched: Boolean(input.mark_dispatched),
        })
        const body = [
          formatMemoList("到期派发结果：", result.memos),
          `派发数量: ${result.dispatched_count}`,
          `已标记派发: ${result.mark_dispatched ? "是" : "否"}`,
          `下一次唤醒（本地时间）: ${formatLocalDateTimeWithZone(result.next_wake_at)}`,
        ].join("\n\n")
        return text(
          body,
          withLocalMemoTime({
            ...result,
            memos: memosWithLocalTime(result.memos),
            next_memo: result.next_memo ? memoWithLocalTime(result.next_memo) : result.next_memo,
            next_wake_at_local: formatLocalDateTimeWithZone(result.next_wake_at),
            dispatched_at_local: formatLocalDateTimeWithZone(result.dispatched_at),
          }),
        )
      },
    },
    {
      name: "get_next_memo_wake",
      label: "获取下一次提醒唤醒",
      description: "获取当前用户下一条未派发提醒/待办的触发时间，用于设置 MonOs 下一次自醒。",
      parameters: Type.Object({
        after: Type.Optional(Type.String({ description: "从这个时间之后查找，默认当前时间。" })),
      }),
      async execute(_toolCallID, rawInput) {
        const input = rawInput as { after?: string }
        const { coreClient, coreToken } = requireCoreMemoAccess(options)
        const result = await coreClient.getNextMemoWake(coreToken, {
          after: normalizeMemoDate(input.after, "after"),
        })
        const body = result.memo
          ? [`下一次提醒唤醒（本地时间）: ${formatLocalDateTimeWithZone(result.next_wake_at)}`, "", memoLine(result.memo)].join("\n")
          : "当前没有需要安排唤醒的提醒/待办。"
        return text(
          body,
          withLocalMemoTime({
            ...(result as unknown as Record<string, unknown>),
            memo: result.memo ? memoWithLocalTime(result.memo) : result.memo,
            next_wake_at_local: formatLocalDateTimeWithZone(result.next_wake_at),
          }),
        )
      },
    },
    {
      name: "complete_memo",
      label: "完成备忘录",
      description: "将一条备忘录或待办标记为已完成。",
      parameters: Type.Object({
        id: Type.Number({ description: "备忘录 ID。" }),
      }),
      executionMode: "sequential",
      async execute(_toolCallID, rawInput) {
        const input = rawInput as { id: number }
        const { coreClient, coreToken } = requireCoreMemoAccess(options)
        const memo = await coreClient.completeMemo(coreToken, input.id)
        return text(`已完成备忘录。\n\n${memoLine(memo)}`, withLocalMemoTime({ memo: memoWithLocalTime(memo) }))
      },
    },
    {
      name: "snooze_memo",
      label: "稍后提醒",
      description: "把一条备忘录/提醒推迟到稍后再次触发。",
      parameters: Type.Object({
        id: Type.Number({ description: "备忘录 ID。" }),
        until: Type.Optional(Type.String({ description: "推迟到的时间，优先于 minutes。" })),
        minutes: Type.Optional(Type.Number({ description: "从现在起推迟多少分钟。" })),
      }),
      executionMode: "sequential",
      async execute(_toolCallID, rawInput) {
        const input = rawInput as { id: number; until?: string; minutes?: number }
        const { coreClient, coreToken } = requireCoreMemoAccess(options)
        const memo = await coreClient.snoozeMemo(coreToken, input.id, {
          until: normalizeMemoDate(input.until, "until"),
          minutes: input.minutes,
        })
        return text(`已设置稍后提醒。\n\n${memoLine(memo)}`, withLocalMemoTime({ memo: memoWithLocalTime(memo) }))
      },
    },
    {
      name: "mark_memo_triggered",
      label: "标记提醒已触发",
      description: "将一条到期提醒标记为已触发，避免后台重复提醒。",
      parameters: Type.Object({
        id: Type.Number({ description: "备忘录 ID。" }),
      }),
      executionMode: "sequential",
      async execute(_toolCallID, rawInput) {
        const input = rawInput as { id: number }
        const { coreClient, coreToken } = requireCoreMemoAccess(options)
        const memo = await coreClient.markMemoTriggered(coreToken, input.id)
        return text(`已标记提醒触发。\n\n${memoLine(memo)}`, withLocalMemoTime({ memo: memoWithLocalTime(memo) }))
      },
    },
  ]
}
