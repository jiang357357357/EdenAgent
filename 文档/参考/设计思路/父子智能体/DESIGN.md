# 父子智能体 · 异步协作设计文档

## 一、文档状态

- 状态：设计定稿；P0、P1、P2、D1 与 D2 已实现，D3 持续评测基线已建立
- 适用范围：Eden Agent Python Server、Python AgentCore、Web/桌面客户端
- 设计来源：Codex 的主智能体协调规则、OpenCode 的后台 Task 结果回注方式，以及 Eden Agent 现有运行时约束
- 核心目标：主智能体持续分析并向用户提供阶段性回复，同时将独立任务交给后台子智能体；必要结果收齐后，再生成最终整合回复

本文同时记录目标架构和分阶段实现状态；未标记为已实现的 P2、D2、D3 行为仍属于后续工作。

## 二、设计结论

采用混合架构：

> **Codex 式任务委派规则 + OpenCode 式后台结果通知 + Eden Agent 持久化协调批次与内部整合运行**

不采用以下两种极端形式：

1. 不完全依赖模型自行 `wait_agent`。模型可能在子任务完成前结束当前运行，后台结果无法自动进入最终回答。
2. 不让父 Agent 长时间占用同一次 HTTP/SSE 运行等待所有子任务。这样会让会话持续 busy，影响用户继续输入，并把网络连接生命周期与后台任务生命周期绑定。

最终运行方式是：

```text
用户请求
  ↓
父运行 #1
  ├─ 主智能体分析
  ├─ 发送阶段性回复
  └─ 异步生成独立子任务
          ↓
父运行 #1 正常结束，消息标记 provisional
          ↓
子智能体继续在 RuntimeHost 中运行
          ↓
结果持久化到 CoordinationBatch
          ↓
所有 required 任务进入终态
          ↓
Manager 排队一次内部 aggregation 运行
          ↓
重新创建 Root Agent，读取会话历史和批次结果
          ↓
验证并整合结果，生成 final 回复
```

## 三、为什么需要新的协调层

当前项目已经具备大部分基础设施：

- `AgentControl` 管理子智能体树、并发、邮箱、等待和中断。
- `RuntimeHost` 提供独立 asyncio 运行线程，子任务不会绑定单个 HTTP 请求。
- `SubagentThreadRepository` 持久化线程、事件、检查点和邮箱。
- `Agent` 提供 `steer()`、`follow_up()` 和 `continue_run()`。
- Server Manager 已将 `agent.*` 事件映射为 `subagent.*` 事件。
- 前端已经能够显示子智能体活动。

缺少的是：

1. 哪些子任务是当前最终回答所必需的。
2. 多个子任务结果如何批量、幂等地收集。
3. 父运行结束后如何自动启动一次结果整合运行。
4. 内部整合运行与用户新消息发生竞争时如何仲裁。
5. 服务重启后如何恢复尚未完成的协调批次。
6. 前端如何区分阶段性回复与最终回复。

这些职责属于 Server 协调层，不应塞入 AgentCore 的通用事件循环。

## 四、委派原则

### 4.1 应当生成子智能体

只有任务同时满足以下条件时才应委派：

- 目标明确，有可验证的交付结果。
- 边界清晰，可以独立完成。
- 与主智能体当前工作不重叠。
- 能与主线工作并行，或能隔离大量工具输出和上下文。
- 委派收益大于额外模型调用、上下文构造和结果整合成本。

典型场景：

- 分别研究 OpenCode、Codex 和 Eden Agent 的实现。
- 同时检查后端运行链路、前端事件处理和测试覆盖。
- 大范围代码探索、多来源研究、独立代码审查。

### 4.2 不应生成子智能体

- 单一事实查询。
- 已知文件或类的直接读取。
- 两三个文件即可完成的简单搜索。
- 主智能体也准备执行同一工作。
- 子任务结果无法改变或支撑当前回答。

### 4.3 主智能体职责

- 理解用户目标并拆分任务。
- 保留不重叠的主线工作。
- 向用户发送阶段性信息。
- 判断子任务是必要还是可选。
- 验证、比较和整合子智能体结果。
- 处理失败、冲突、过期和不完整结果。
- 生成最终回复。

子智能体只返回工作结果，不直接替代主智能体面向用户做最终决策。

## 五、工具接口

### 5.1 `spawn_agent`

在现有参数上增加：

```json
{
  "task_name": "inspect_codex",
  "message": "分析 Codex 多智能体实现并返回关键文件和结论",
  "role": "researcher",
  "fork_turns": "all",
  "background": true,
  "required_for_final": true
}
```

参数语义：

| 参数 | 含义 |
|------|------|
| `background=true` | 立即返回线程快照，子智能体继续后台运行 |
| `background=false` | 工具内部等待该任务进入终态后返回 |
| `required_for_final=true` | 任务加入当前协调批次的必要任务集合 |
| `required_for_final=false` | 任务不阻止当前批次完成，可在后续使用结果 |

服务当前用户请求的普通委派默认建议：

```text
background = true
required_for_final = true
```

长期调查、预取或监控任务应显式设置 `required_for_final=false`。

### 5.2 控制工具可见性

以下六个工具应作为 Root Agent 的协调控制面始终可见：

- `spawn_agent`
- `send_message`
- `followup_task`
- `list_agents`
- `wait_agent`
- `interrupt_agent`

`multi-agent` 技能继续保留，但只提供委派规则、角色说明、并发原则和结果整合要求，不再负责解锁工具。

子智能体默认不获得 `spawn_agent`，避免递归分裂。将来只有专用 orchestrator 角色可以显式获得递归委派权限。

## 六、数据模型

### 6.1 协调批次

```python
@dataclass
class CoordinationBatch:
    batch_id: str
    session_id: str
    source_turn_id: str
    objective_epoch: int

    status: Literal[
        "collecting",
        "ready",
        "aggregating",
        "aggregation_failed",
        "completed",
        "cancelled",
    ]

    required_task_ids: set[str]
    optional_task_ids: set[str]
    terminal_task_ids: set[str]

    pending_results: dict[str, dict]
    delivered_result_keys: set[str]

    aggregation_scheduled: bool
    created_at: int
    updated_at: int
```

一个父运行可以没有批次，也可以建立一个批次并生成多个子任务。第一阶段不支持一个父运行创建多个并行批次，以降低状态复杂度。

### 6.2 子任务协调元数据

复用 `AgentControl.spawn(metadata=...)`：

```json
{
  "coordinationBatchID": "batch_xxx",
  "requiredForFinal": true,
  "objectiveEpoch": 3,
  "attemptID": "attempt_xxx",
  "deadlineAt": 1785000000000
}
```

第一阶段不需要修改 AgentCore 的 `AgentSnapshot` 或 `AgentControl.spawn()` 签名。

### 6.3 结果幂等键

```text
result_key = task_id + ":" + attempt_id
```

终态事件可能因恢复、重试或网络重放重复到达。只有首次出现的 `result_key` 可以更新批次并触发调度。

## 七、状态机

### 7.1 子任务状态

```text
queued → running
running → completed
running → failed
running → interrupted
running → timed_out
```

`completed`、`failed`、`interrupted`、`timed_out` 都是终态，都必须从必要任务屏障中解除。

### 7.2 协调批次状态

```text
collecting
  ├─ required 尚未全部终态 → collecting
  ├─ required 全部终态     → ready
  └─ 用户取消/目标被替换    → cancelled

ready
  ├─ 排队等待内部运行       → ready
  └─ 内部运行开始           → aggregating

aggregating
  ├─ 整合成功               → completed
  ├─ 整合失败               → aggregation_failed（避免自动重试风暴）
  └─ 用户取消/目标被替换    → cancelled

aggregation_failed
  ├─ 用户或恢复策略显式重试 → ready
  └─ 用户取消/目标被替换    → cancelled
```

### 7.3 最终完成条件

```python
required_ready = batch.required_task_ids <= batch.terminal_task_ids
can_aggregate = batch.status == "collecting" and required_ready
```

不单独持久化 `final_locked`。它可以由批次状态和必要任务集合推导，避免双重状态不一致。

## 八、原子性与竞态控制

### 8.1 生成任务

必须先登记协调信息，再启动子线程：

```text
1. 创建 task_id / attempt_id
2. 持久化任务协调记录
3. 将 task_id 加入批次 required 或 optional 集合
4. 提交持久化更新
5. 调用 AgentControl.spawn
6. 更新线程状态为 queued/running
```

如果 spawn 失败：

```text
7. 写入 failed 结果
8. 将 task 加入 terminal_task_ids
9. 重新计算批次是否 ready
```

不能先 spawn 后登记屏障，否则极快完成的子任务可能在登记前返回。

如果现有 `AgentControl` 暂时不能接收外部生成的 task ID，P0 可以在调用 `spawn` 前先创建“待绑定任务记录”，spawn 返回后原子绑定真实 agent ID；终态处理必须能够识别未完成绑定的记录。

### 8.2 终态结果处理

```python
async with session_coordination_lock:
    batch = repository.get_batch(batch_id)
    result_key = f"{task_id}:{attempt_id}"

    if result_key in batch.delivered_result_keys:
        return

    repository.persist_terminal_result(...)
    batch.delivered_result_keys.add(result_key)
    batch.terminal_task_ids.add(task_id)
    batch.pending_results[task_id] = normalized_result

    if batch.required_task_ids <= batch.terminal_task_ids:
        batch.status = "ready"
        enqueue_aggregation_once(batch)
```

持久化必须发生在发布 UI 事件和启动 aggregation 之前。

### 8.3 失败结果

失败、超时和中断仍要产生可整合结果：

```json
{
  "taskID": "agt_xxx",
  "status": "failed",
  "summary": "子任务未完成",
  "error": "连接模型服务失败",
  "partialResult": null
}
```

主智能体在最终回复中决定重试、降级，或向用户说明结论限制。

## 九、父 Agent 生命周期

### 9.1 不复用已经结束的 Root Agent

当前 Server 每次 `_run_prompt` 都创建新的 Root `Agent`，运行结束后 `_finish_submission` 会从 `_agents` 中移除该实例。

因此：

- 父 Agent 仍在当前 run 中时，紧急信息可以使用 `steer()`。
- 父 run 已结束后，不能依赖旧实例执行 `follow_up() + continue_run()`。
- 正常子任务结果不应逐个 `steer()`；应先持久化并等待批次 ready。
- 批次 ready 后，Manager 创建一次新的内部 aggregation run。

### 9.2 为什么不逐个唤醒

错误方式：

```text
A 完成 → 唤醒模型
B 完成 → 再唤醒模型
C 完成 → 再唤醒模型
```

正确方式：

```text
A 完成 → 持久化
B 完成 → 持久化
C 完成 → 持久化
required 全部终态 → 只启动一次 aggregation run
```

`aggregation_scheduled` 和会话锁共同保证只调度一次。

## 十、内部整合运行

Manager 新增：

```python
async def _run_aggregation(
    self,
    session_id: str,
    batch_id: str,
) -> None:
    ...
```

运行步骤：

1. 从 SessionStore 读取现有会话消息。
2. 从 Repository 读取批次和全部终态结果。
3. 确认批次仍属于当前 `objective_epoch`。
4. 使用当前模型配置重新创建 Root Agent。
5. 注入内部结构化结果消息。
6. 要求模型验证、比较和整合，而不是原样复制。
7. 生成 `completionState=final` 的 assistant 消息。
8. 将批次标记为 `completed`。

内部上下文示例：

```xml
<subagent_batch_result batch_id="batch_xxx" objective_epoch="3">
  <task id="agt_a" status="completed">...</task>
  <task id="agt_b" status="failed">...</task>
</subagent_batch_result>

请验证并整合以上子任务结果。
不要逐字复制子智能体输出。
说明失败任务对结论可靠性的影响。
这是该协调批次的最终整合阶段。
```

这条内部消息应进入模型上下文和审计事件，但不应作为普通用户消息显示在聊天列表中。

## 十一、会话运行仲裁

内部 aggregation 和用户新消息可能同时请求运行。Manager 需要统一队列：

```python
@dataclass
class PendingSessionRun:
    kind: Literal["user", "aggregation"]
    session_id: str
    payload: dict
    created_at: int
```

规则：

1. 一个 session 同时只允许一个实际运行。
2. 用户运行优先于 aggregation。
3. 子任务全部完成时，只将 aggregation 放入队列，不直接抢占正在执行的用户运行。
4. 用户运行结束后重新检查等待中的 aggregation 是否仍然相关。
5. 目标被替换的批次转为 `cancelled`，不再自动整合。
6. 状态查询、追问进度等消息不自动使批次失效。

当前 `prompt_async` 在 session busy 时直接报错。P1 应将其收敛为统一的会话仲裁入口，而不是为 aggregation 单独绕过 `_running`。

## 十二、目标版本与用户转向

`objective_epoch` 只在用户明确替换或取消当前目标时递增：

| 用户行为 | epoch 是否变化 |
|----------|----------------|
| “进度怎么样了？” | 否 |
| “顺便也看看 OpenCode” | 否，向原批次增加任务或创建关联批次 |
| “不用分析 Codex 了，改看 Claude” | 是 |
| “取消之前所有任务” | 是，并中断旧任务 |

旧 epoch 的结果仍持久化用于审计，但不得自动注入当前回答。

第一阶段可以仅支持用户显式取消/替换时更新 epoch，不引入额外意图分类模型。

## 十三、阶段性回复与最终回复

assistant 消息增加：

```typescript
type CompletionState = "provisional" | "final"
```

父运行创建了 required 子任务：

```json
{
  "completionState": "provisional",
  "coordinationBatchID": "batch_xxx"
}
```

没有 required 子任务，或 aggregation 成功完成：

```json
{
  "completionState": "final",
  "coordinationBatchID": "batch_xxx"
}
```

服务端负责最终校正该状态，不能完全相信模型自行声明 final。

前端应显示：

- 后台必要任务数量。
- 当前处于收集还是整合阶段。
- 每个子智能体的角色、任务名和状态。
- provisional 回复不锁住用户输入。
- aggregation 完成后追加最终回复，而不是覆盖阶段性回复。

## 十四、运行模式

```text
disabled   完全禁止委派
explicit   仅用户、AGENTS.md 或技能明确要求时委派
auto       主智能体发现独立并行任务时自主委派
proactive  大型任务优先主动拆分
```

第一阶段只开放 `explicit` 和 `auto`。

`auto` 默认规则：

> 只有具体、有边界、可以独立执行，并且主智能体还有不重叠的有效工作时才生成子智能体。

暂不使用“搜索三次后自动委派”或额外小模型意图分类器。先让模型基于清晰规则决策，并收集实际指标。

### 14.1 信息获取型任务的自动委派

信息获取是 `auto` 模式下最应优先委派的一类工作，但“使用了搜索工具”本身不是充分条件。主智能体按以下五个维度做语义判断：

1. **不确定性**：是否需要反复改写关键词、追踪线索或排除歧义。
2. **搜索空间**：范围是否跨站点、目录、模块、仓库或大量日志。
3. **上下文污染**：原始网页、代码片段和日志是否会挤占主会话上下文。
4. **并行收益**：主智能体是否还有可以同时进行且不重复的分析或回复工作。
5. **结论深度**：用户需要的是原始事实，还是带来源、交叉验证和归因的结论。

满足其中多个维度时应强烈倾向委派；不要以“预计会调用两次工具”“已经搜索三次”或关键词命中作为硬阈值。

角色路由：

| 任务形态 | 角色 | 例子 |
|------|------|------|
| 实时外部信息、多来源检索、需要调整关键词或核对来源 | `researcher` | 最新动态、产品现状、资料调研、事实核验 |
| 位置未知、跨目录/模块/仓库、调用链和全部引用查找 | `explore` | “认证流程在哪里实现”“找出所有会话状态写入点” |
| 日志、测试失败、跨组件关联和根因归纳 | `general` | “为什么请求卡住”“从服务端日志定位根因” |
| 路径、符号、网址或数据源已经精确给出，且一次读取即可回答 | 主智能体直接处理 | 读取指定文件、查看指定函数、总结单个 URL、天气/时间查询 |

该路由由主模型根据任务语义选择，第一阶段不增加关键词路由器或额外分类模型。提示词应给出正反例，避免模型把所有只读操作机械地委派。

### 14.2 默认生成参数

普通信息获取子任务默认：

```json
{
  "background": true,
  "required_for_final": true,
  "fork_turns": "none"
}
```

- `background=true`：父运行可以继续分析、组织阶段性回复或处理不重叠工作。
- `required_for_final=true`：调研结果通常是最终结论的必要证据；纯预取、可有可无的扩展资料才显式设为 `false`。
- `fork_turns=none`：由任务说明携带最小必要上下文，避免复制主会话噪声。只有任务依赖近期对话中的指代、约束或附件时，才传最近若干轮；极少使用 `all`。

父智能体不应为 required 任务手动轮询或调用 `wait_agent` 阻塞当前运行。现有 `CoordinationBatch` 在结果齐备后自动发起内部 aggregation；父智能体可以先发送 provisional 回复，用户也可以继续输入。

### 14.3 父子去重与结果验收

子智能体开始宽搜索后，父智能体不再重复相同范围的搜索。父智能体可以做窄范围验证，例如读取子智能体指出的关键文件、检查一条核心来源或复现一个明确命令。

父智能体的验收对象是结果而不是重新执行全过程：

- 是否覆盖了任务要求。
- 结论之间是否矛盾。
- 事实能否追溯到文件、行号、日志或网页来源。
- 是否存在没有证据支撑的推断。
- 是否明确说明失败、缺口和不确定性。

结果不完整时优先使用 `followup_task` 要求原子智能体补查，不应立即新建同范围任务。第一阶段通过提示词约束去重；运行时只记录父子工具类别与目标重叠指标，不做硬拦截，因为父智能体的窄验证是合理行为。后续严格模式也必须按“任务类别 + 目标范围”判断精确重复，不能只按工具名封禁。

### 14.4 代码落点与实施顺序

#### D1：语义策略可用

1. 在 `runtime/config.py` 增加 `DelegationPolicy`，读取 `disabled | explicit | auto | proactive`；首期启用 `explicit`、`auto`，默认 `auto`。
2. 在 `prompts/builder.py::build_agent_system_prompt()` 注入当前模式、五维判断、角色路由、直接处理反例、去重和结果验收规则。
3. 更新 `skills/catalog.py` 的 `multi-agent` 指令：后台 required 任务依赖协调批次自动聚合，不再指导父智能体调用 `wait_agent`。
4. 将 `tools/subagents.py` schema 与 `runtime/manager.py` 中 `required_for_final` 的缺省值统一为 `true`；optional 任务必须显式声明。
5. 保持 Root 协作工具常驻、Child 禁止递归生成的现有边界。

#### D2：可观测性与保护

1. spawn 记录 `taskCategory`、`roleReason`、`requiredReason` 和最小目标范围，便于审计模型为何委派。
2. 记录 eligible delegation rate、父子重叠率、结果利用率、每批任务数、聚合失败率、延迟与上下文用量。
3. 为单批任务数、结果大小和 deadline 增加生产限制。
4. 当用户目标变化时，通过 objective epoch 隔离旧结果。

#### D3：评测后再增强

1. 建立固定评测集，比较 `explicit` 与 `auto` 的质量、延迟和 token 消耗。
2. 只有实际数据证明提示词约束不足时，才增加可选 strict 策略。
3. `proactive` 模式在大型任务评测稳定后开放，不作为初始默认。

### 14.5 决策样例与验收指标

应委派：多来源联网调研、模糊代码定位、跨文件调用链、全量引用搜索、长日志根因分析，以及可并行的文档/代码/历史调查。

应直接处理：精确文件读取、精确符号查看、单一已知 URL 摘要、结构化天气/时间查询，以及对子智能体结论的一次窄验证。

除现有功能测试外，增加提示词快照和确定性假模型用例，验证上述正反例。上线观察目标：

- 有资格任务的委派率持续上升，但简单任务误委派率低于 10%。
- required 子任务结果在最终 aggregation 中的利用率高于 90%。
- 同范围父子重复搜索率持续下降。
- 常规批次生成 1～4 个边界清晰的子任务，不产生无意义分裂。
- 委派失败、超时或用户打断时不会永久停留在 provisional 状态。

## 十五、持久化与恢复

`SubagentThreadRepository` 继续作为后台线程和协调数据的耐久存储。建议新增批次存储：

```text
Data/AgentThreads/<session-key>/
├── threads.json
├── mailboxes.json
├── coordination/
│   ├── batch_<id>.json
│   └── results_<id>.jsonl
└── agents/<agent-id>/...
```

服务重启时：

1. 恢复线程快照和检查点。
2. 恢复 collecting/ready/aggregating 批次。
3. 对 running 线程执行现有 reconcile。
4. 对 ready 且未调度的批次重新排队 aggregation。
5. 对 aggregating 但没有对应活动运行的批次回退到 ready。
6. 使用结果幂等键避免重复整合。

P0 可以先实现同进程闭环，P2 再完成完整重启恢复，但数据模型从 P0 起必须可持久化。

## 十六、事件设计

新增或规范化：

```text
subagent.batch.created
subagent.batch.updated
subagent.batch.ready
subagent.batch.aggregating
subagent.batch.completed
subagent.batch.cancelled
```

事件载荷至少包含：

```json
{
  "sessionID": "...",
  "batchID": "...",
  "status": "collecting",
  "requiredTotal": 3,
  "requiredTerminal": 1,
  "optionalTotal": 0,
  "objectiveEpoch": 3,
  "updatedAt": 1785000000000
}
```

EventBus 重放缓冲和移除 SessionStore 重复数据不属于核心 P0，后续应单独设计，避免扩大本次改造边界。

## 十七、实施计划

### P0：后台结果闭环

目标：在同一服务进程内跑通“阶段性回复 → 后台任务 → 批量收集 → 内部整合 → 最终回复”。

修改范围：

| 文件 | 改动 |
|------|------|
| `Server/src/eden_agent_server/tools/subagents.py` | spawn schema 增加 `background`、`required_for_final` |
| `Server/src/eden_agent_server/runtime/manager.py` | 创建协调批次、登记任务、处理终态、会话锁、排队 aggregation、新增 `_run_aggregation()` |
| `Server/src/eden_agent_server/store/subagent_repository.py` | 保存批次、标准化终态结果、幂等键 |
| `Server/src/eden_agent_server/skills/catalog.py` | Root Agent 常驻六个协作工具；multi-agent 技能转为策略说明 |
| `Server/src/eden_agent_server/runtime/subagents.py` | 默认子智能体策略禁止递归 spawn |

P0 不修改 AgentCore。

### P1：运行仲裁和前端语义

| 范围 | 改动 |
|------|------|
| Server Manager | 统一 user/aggregation 会话运行队列，用户消息优先 |
| 消息模型 | 增加 `completionState` 和 `coordinationBatchID` |
| 前端 reducer | 消费 batch 事件并维护批次状态 |
| 活动卡片 | 显示 required、collecting、aggregating 和失败状态 |
| 输入框 | 后台收集期间保持可用 |

### P2：恢复与生产保护

- 服务重启恢复批次和待运行 aggregation。
- 任务 deadline 和超时扫描。
- 结果大小和批次任务数限制。
- 旧 epoch 隔离。
- aggregation 有限次数重试。
- 取消批次时中断相关线程。
- 指标、日志和故障审计。

## 十八、测试计划

### 18.1 单元测试

- required 和 optional 任务登记正确。
- 重复终态事件只消费一次。
- 四种终态都能解除必要任务屏障。
- required 未全部终态时批次保持 collecting。
- required 全部终态时只调度一次 aggregation。
- objective epoch 不匹配时不自动整合。
- spawn 失败能形成终态结果，不造成永久等待。

### 18.2 集成测试

- 父运行结束后子智能体仍继续运行。
- 两个 required 任务只完成一个时不启动 aggregation。
- 多个任务同时完成只产生一个 aggregation 运行。
- aggregation 使用完整结果集合，而不是只使用最后一个结果。
- 用户运行和 aggregation 竞争时用户优先。
- aggregation 运行完成后消息标记 final。
- optional 任务不阻止最终回复。
- 子智能体递归 spawn 被拒绝。

### 18.3 恢复测试

- collecting 状态重启后继续等待。
- ready 状态重启后重新调度 aggregation。
- 重复恢复事件不会重复生成最终回复。
- aggregating 状态崩溃后安全回退并有限重试。

### 18.4 前端端到端测试

- provisional 回复出现后输入框仍可用。
- 子智能体状态和必要任务计数实时更新。
- 失败任务有明确状态，不无限转圈。
- 最终整合回复追加到会话，不覆盖阶段性回复。
- 用户取消后旧结果不进入新回答。

## 十九、明确不在第一阶段做的内容

- 不改写 AgentCore 的 Agent 事件循环。
- 不让父 Agent 长时间等待后台任务。
- 不引入额外意图分类模型。
- 不按固定搜索次数强制委派。
- 不删除现有 SessionStore 数据结构。
- 不在本次改造中实现 EventBus 通用事件重放。
- 不默认允许子智能体递归生成。
- 不让每个子任务完成都触发一次模型调用。

## 二十、验收标准

设计实现完成必须满足：

1. 主智能体生成后台任务后仍能结束父运行并提供阶段性回复。
2. 父运行结束后子智能体不会被取消。
3. required 结果未齐时不会生成该批次的最终整合回复。
4. required 全部终态后自动启动且只启动一次 aggregation。
5. aggregation 使用全部已持久化结果。
6. 失败、超时和中断不会造成永久等待。
7. 用户新消息优先于内部 aggregation。
8. 被替换目标的旧结果不会污染当前回答。
9. optional 后台任务不阻止 final。
10. 服务重启后不会丢失必要任务和待整合结果。
11. 子智能体默认无法递归 spawn。
12. 后台收集期间用户仍可继续使用会话。

## 二十一、最终原则

> 主智能体不等待子智能体的工作过程，只在最终整合时消费已经持久化的必要结果。

> 阶段性回复可以结束一次运行，但不能冒充协调批次的最终结论。

> 子智能体完成事件先落盘、后发布、最后调度整合；任何重复事件都必须幂等。

> 用户的新输入永远高于后台内部运行，后台协作不能让会话失去响应能力。
