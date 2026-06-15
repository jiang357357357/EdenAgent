import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import type { AgentTool } from "@earendil-works/pi-agent-core"
import { Type } from "@earendil-works/pi-ai"
import { formatLocalDateTimeWithZone, localTimeZoneLabel, toStorageIso } from "../../shared/time"
import { parseJsonRecord, resolveSelfAwakeStatePath, resolveWakeTime, text, type MonToolOptions } from "./shared"

export function createSelfAwakeTools(workspaceRoot: string, _options: MonToolOptions = {}): AgentTool[] {
  return [
    {
      name: "set_self_awake_timer",
      label: "设置自醒定时器",
      description:
        "调用 MonOs 自醒定时器，设置下一次后台自醒时间。可传 after_minutes 或 at；自醒任务应在决定下次醒来时调用此工具。",
      parameters: Type.Object({
        after_minutes: Type.Optional(Type.Number({ description: "多少分钟后再次自醒。默认 720，受 MonOs 最小/最大范围约束。" })),
        at: Type.Optional(Type.String({ description: "下一次自醒时间。可传带时区 ISO；若传普通日期时间字符串，将按本地时区解析。" })),
        reason: Type.Optional(Type.String({ description: "设置这个自醒时间的原因。" })),
      }),
      executionMode: "sequential",
      async execute(_toolCallID, rawInput) {
        const input = rawInput as { after_minutes?: number; at?: string; reason?: string }
        const timer = await resolveSelfAwakeStatePath(workspaceRoot)
        const wake = resolveWakeTime(input, timer.minMinutes, timer.maxMinutes)
        const now = new Date()
        const reason = input.reason?.trim() || "Agent 设置下一次自醒时间。"

        await mkdir(path.dirname(timer.statePath), { recursive: true })
        const state = parseJsonRecord(await readFile(timer.statePath, "utf8").catch(() => ""))
        state.enabled = true
        const nextWakeIso = toStorageIso(wake.nextWakeAt)
        state.next_wake_at = nextWakeIso
        state.next_wake_after_minutes = wake.afterMinutes
        state.next_wake_reason = reason
        state.last_timer_tool_at = toStorageIso(now)
        state.last_timer_tool_source = "monagent"

        const tmpPath = `${timer.statePath}.tmp`
        await writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, "utf8")
        await rename(tmpPath, timer.statePath)

        return text(
          [
            "已调用 MonOs 自醒定时器。",
            `下次自醒（本地时间）: ${formatLocalDateTimeWithZone(wake.nextWakeAt)}`,
            `间隔: ${wake.afterMinutes} 分钟`,
            `原因: ${reason}`,
          ].join("\n"),
          {
            next_wake_at: nextWakeIso,
            next_wake_at_local: formatLocalDateTimeWithZone(wake.nextWakeAt),
            time_display_timezone: localTimeZoneLabel(),
            time_display_note: "面向用户展示和回复时请使用 *_local 字段，不要直接复述 ISO/UTC 原始字段。",
            after_minutes: wake.afterMinutes,
            reason,
            state_path: timer.statePath,
          },
        )
      },
    },
  ]
}
