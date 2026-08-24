# 自检系统 · 设计文档

## 一、核心理念

> **LLM 自决调度（Appointment-based Self-check）**

每次自检完成后，由 LLM 根据检查结果、上下文心情、当前时间等因素，自主决定下一次自检的时间。

```
┌──────────────────────────────────────────────────────────┐
│                      预约循环                             │
│                                                          │
│   ┌──────────┐      ┌──────────┐      ┌─────────────┐   │
│   │ 现在时间  │ ───→ │ 到了预约？ │ ─否→│ sleep(30s)  │   │
│   └──────────┘      └────┬─────┘      └──────┬──────┘   │
│                          │是                 │          │
│                          ▼                    │          │
│                   ┌──────────┐               │          │
│                   │  自检     │               │          │
│                   │ LLM 评估  │               │          │
│                   └────┬─────┘               │          │
│                        │                     │          │
│                        ▼                     │          │
│            ┌─────────────────────┐           │          │
│            │ LLM 决定下次预约时间  │           │          │
│            │ "30分钟后" "1小时后" │           │          │
│            │ "明天早上" "无所谓"  │           │          │
│            └──────────┬──────────┘           │          │
│                       │                     │          │
│                       └─────────────────────┘          │
│                         更新 nextScheduled               │
└──────────────────────────────────────────────────────────┘
```

## 二、数据模型

### 2.1 自检状态（持久化到 .eden-agent/check-state.json）

```typescript
interface CheckState {
  /** 实例 ID */
  instanceId: string
  /** 上次自检时间 */
  lastCheckAt: string  // ISO 8601
  /** LLM 设定的下次自检时间 */
  nextScheduled: string  // ISO 8601
  /** 自检历史（保留最近 20 条） */
  history: CheckRecord[]
  /** 是否启用 */
  enabled: boolean
}

interface CheckRecord {
  id: string
  at: string               // 自检时间
  summary: string          // LLM 总结（"一切正常~"）
  findings: Finding[]      // 发现项
  nextScheduled: string    // 本次设定的下次时间
  llmReasoning: string     // LLM 为什么选这个时间
}

interface Finding {
  severity: "info" | "warning" | "critical"
  category: string         // "dependency" / "disk" / "git" / "lint" / "custom"
  title: string            // "lodash 存在安全漏洞"
  detail: string
  suggestion?: string
  resolved: boolean
}
```

### 2.2 LLM 结构化输出（决定下次时间）

```
SYSTEM: 你是苏岚。刚完成了一次自检。请用 JSON 回复：
{
  "summary": "用傲娇语气总结（1-2句）",
  "findings": [...],
  "nextCheckIn": "30 minutes"   // 自然语言时间表达
}
```

`nextCheckIn` 支持自然语言，后端解析：
- `"30 minutes"` / `"1 hour"` / `"2 hours"`
- `"tomorrow morning"` → 明天 9:00
- `"this afternoon"` → 今天 14:00
- `"when I feel like it"` / `"no need now"` → 默认 6 小时后
- 空或无法解析 → 默认 1 小时后

## 三、文件结构

```
packages/eden-agent/src/session/
├── check/
│   ├── index.ts          ← 自检模块入口（Effect Service）
│   ├── state.ts          ← CheckState 读写（.eden-agent/check-state.json）
│   ├── scheduler.ts      ← 后台循环（定时检查是否到预约时间）
│   ├── run-check.ts      ← 执行一次自检（组装 prompt → 调 LLM → 解析结果）
│   ├── checklist.ts      ← 检查项注册表（内置 + 可扩展）
│   └── tools.ts          ← 自检专用工具（check_git, check_deps…）
└── prompt.ts             ← 改动：session 初始化时启动 CheckService
```

## 四、自检流程

### 4.1 调度器循环（scheduler.ts）

```
Effect.loop(30秒间隔) {
  读取 CheckState
  if !enabled || now < nextScheduled → continue（还没到时间）

  标记 lastCheckAt = now
  调用 run-check.ts 执行自检
  → LLM 返回 { summary, findings, nextCheckIn }
  解析 nextCheckIn → 计算 nextScheduled
  持久化 CheckState

  如果有 findings.severity === "warning" || "critical"
    → 推送通知到前端
}
```

### 4.2 一次自检（run-check.ts）

```
1. 组装 System Prompt：
   - identity.txt（苏岚人设）
   - 自检专用指令：
     "前辈现在不在。检查一下工作区状态。
      你可以使用工具查看 git log、npm outdated、磁盘空间、错误日志等。
      然后决定是否需要提醒前辈。
      最后用 JSON 告诉我下次检查时间。"

2. 组装用户消息（合成消息）：
   "苏岚，看看现在有什么需要前辈注意的吗？"

3. 调用 LLM（走现有 llm.ts + processor.ts）
   - 允许的工具：bash（只读）, read, glob, grep
   - 期望结构化输出

4. 解析 LLM 回复 → Findings + nextCheckIn

5. 持久化
```

## 五、检查项体系

### 5.1 内置检查项

| 类别 | 检查内容 | 工具 | 示例 |
|------|----------|------|------|
| **git** | 未提交变更、未推送提交 | `git status`, `git log` | "有 3 个文件改了还没提交" |
| **deps** | 依赖安全漏洞、过期 | `npm outdated` / `npm audit` | "lodash@4.17.20 有 CVE-2024" |
| **disk** | 磁盘空间 | 系统命令 | "C盘只剩 5GB 了笨蛋前辈" |
| **lint** | 代码 lint / 类型错误 | `tsc --noEmit`, `npm run lint` | "有 12 个类型错误没修" |
| **build** | 构建是否通过 | `npm run build` | "构建失败，可能是昨天改的..." |
| **error_log** | 最近错误日志 | 读 logs 文件 | "昨晚 3 点有个 unhandled 错误" |

### 5.2 检查策略（LLM 自主决定）

**不给 LLM 固定检查清单。** LLM 根据上下文自行决定查什么：

```
SYSTEM: 你可以自由选择检查什么。优先检查：
1. 最可能有问题的（git 未提交、错误日志）
2. 上次自检有问题但未解决的
3. 距离上次检查时间长的项目
不需要全查——你觉得没必要就跳过。
```

### 5.3 默认策略（t=0，首次自检）

如果是第一次自检，LLM 没有历史参考，给一个默认推荐：
- git status（基本）
- 如果有 package.json → npm outdated
- 磁盘空间

## 六、与现有引擎的集成

### 6.1 prompt.ts 改动

```
在 session 初始化时（首次创建实例）：
  CheckService.start(instanceId, sessionId)
    → 后台 Effect.forkDaemon(scheduler_loop)
    → 不阻塞主循环
```

### 6.2 自检复用现有 LLM 架构

```typescript
// run-check.ts 伪代码
const runCheck = (state: CheckState) =>
  Effect.gen(function* () {
    const model = yield* provider.defaultModel()
    const system = [
      yield* SystemPrompt.provider(model),  // identity.txt + tasks.txt
      CHECK_INSTRUCTIONS,                    // 自检专用指令
    ]
    const messages = [
      { role: "user", content: "苏岚，看看现在有什么需要前辈注意的吗？" }
    ]

    // 复用现有 LLM stream
    const result = yield* llm.stream({
      model,
      system,
      messages,
      tools: readOnlyTools,  // 只允许只读工具
    })

    // 解析结构化输出
    const parsed = yield* parseCheckResult(result.text)

    // 更新状态
    yield* CheckState.save({
      ...state,
      lastCheckAt: new Date().toISOString(),
      nextScheduled: resolveNextTime(parsed.nextCheckIn),
      history: [...state.history, { ...parsed }],
    })

    return parsed
  })
```

### 6.3 通知通道

```
run-check.ts 完成 → 如果有 warning/critical 级别发现
  → Bus.publish(CheckEvent.Finding, { ... })
  → SSE 或 WebSocket → 前端 → 苏岚冒泡通知
```

前端新增 `GET /api/check/notifications` 端点，返回未读通知列表。

## 七、前端对接

### 7.1 通知组件

苏岚角色面板（右侧）的 Online 状态旁边，新增一个**铃铛图标**：

- 无通知：安静
- 有 info：蓝色小圆点
- 有 warning：橙色小圆点 + 气泡 "前辈，lodash 有漏洞哦"
- 有 critical：红色小圆点 + 气泡 "前辈！有个严重问题！！"

### 7.2 自检控制

在 Web 前端设置面板中新增：
- 自检开关（启用/暂停）
- "立即检查"按钮
- 上次检查结果摘要
- 下次检查时间倒计时

## 八、实现计划

| 阶段 | 内容 | 文件 |
|------|------|------|
| **P1** | CheckState 数据模型 + 读写 | `check/state.ts` |
| **P2** | LLM 调度逻辑（parser + nextTime） | `check/run-check.ts` |
| **P3** | 后台调度循环（30s 心跳） | `check/scheduler.ts` |
| **P4** | 模块入口 + Effect Service 注册 | `check/index.ts` |
| **P5** | 集成到 prompt.ts（session init 启动） | `prompt.ts` |
| **P6** | 通知 API + 前端铃铛组件 | Web 前端 |
| **P7** | 自检历史查看 + 设置面板 | Web 前端 |

---

## 附录：nextCheckIn 解析规则

```typescript
function resolveNextTime(input: string): Date {
  const now = new Date()

  // 数字 + 单位
  const match = input.match(/(\d+)\s*(分钟|minute|hour|小时|day|天)/)
  if (match) {
    const n = parseInt(match[1])
    if (match[2].includes("分") || match[2].includes("min")) return addMinutes(now, n)
    if (match[2].includes("小时") || match[2].includes("hour")) return addHours(now, n)
    if (match[2].includes("天") || match[2].includes("day")) return addDays(now, n)
  }

  // 自然语言
  if (/明天.*早|morning/.test(input)) return tomorrowAt(9, 0)
  if (/明天.*晚|evening/.test(input)) return tomorrowAt(20, 0)
  if (/明天/.test(input)) return tomorrowAt(14, 0)
  if (/下午|afternoon/.test(input)) return todayAt(14, 0)
  if (/晚上|tonight/.test(input)) return todayAt(20, 0)

  // LLM 说不想查 → 默认 6 小时
  if (/不用|没有|不查|no need|skip/.test(input)) return addHours(now, 6)

  // 兜底
  return addHours(now, 1)
}
```
