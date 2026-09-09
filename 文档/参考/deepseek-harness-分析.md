# DeepSeek Harness 源码分析

> 分析对象：`deepseek-ai/deepseek-harness` `master` 分支源码快照  
> 上游 HEAD：`5dda764ed3aa172535a7967b06ff95d9cbfe536a`  
> 分析日期：2026-09-09  
> 本地源码：`文档/参考/deepseek-harness`

## 1. 结论先行

DeepSeek Harness（命令名 `dsh`）不是一个“DeepSeek API + 工具调用”的简单示例，也不是 DeepSeek 对 Pi Agent 的直接换皮。它是一套完整的本地智能体 Harness：用 Cordis 作为依赖注入、插件生命周期和事件组合框架，把模型适配器、Agent Loop、会话日志、工具、权限、沙箱、Web/桌面端、SDK、子智能体等全部做成可装配插件。

它的核心代码方案可以概括为：

```text
命名 Profile
  -> 叠加 Bundle / cordis.patch.yml
  -> 构造 Cordis 插件树与共享 Context
  -> Agent Service + Agent Loop
  -> 从持久事件日志派生模型上下文
  -> LLM 流式请求
  -> 守卫化、可并发的工具执行管线
  -> 结果先写事件日志，再进入下一 Step
  -> Web / Electron / TypeScript SDK / Python SDK 投影同一运行时
```

对 Eden Agent 最有价值的不是照搬 TypeScript 或 265 个细粒度包，而是它对四件事的形式化：可替换能力接缝、运行配置分层、模型上下文可重放、事件投影。

## 2. 仓库与技术栈

- 开源协议：MIT。
- 当前版本：`0.1.5-alpha.1`，官方明确标记为 developer preview，并警告会有破坏性变更。
- 运行环境：Node.js `^22.19.0 || >=24.0.0`、pnpm `11.7.0`、TypeScript 6。
- 前端与宿主：Web、Electron Desktop、Node CLI。
- SDK：TypeScript 与 Python；Python SDK 实际打包并拉起同一个 `dsh --profile sdk` Node 运行时，不是另一套 Python Agent Loop。
- 规模：`packages/*/*` 下有 265 个包目录；`packages`、`apps`、`native` 内约 3272 个 TS/TSX/Python/Rust 源文件；源码快照约 97 MB。
- 原生部分：本地沙箱等少量平台能力包含 Rust/native 代码，主体仍是 TypeScript。

## 3. “Everything is a Plugin” 到底怎么工作

Cordis 提供共享 `Context`、服务注册、类型化事件和可逆副作用。插件卸载时，它注册的服务、监听器和其他 effect 会跟着撤销。因此 Harness 没有一个必须不断打补丁的特权核心；常规扩展通过挂载新插件完成。

关键服务包括：

| 服务 | 职责 |
|---|---|
| `ctx.sessions` | 追加式 `SessionEvent` 日志与内存会话 |
| `ctx.systemPrompt` | 系统提示词区段和工具 schema 装配 |
| `ctx.tools` | 有作用域的工具注册表及守卫执行管线 |
| `ctx.agents` | Agent 接口、实例注册与生命周期事件 |
| `ctx.agentLoop` | 默认的“模型—工具—再请求”驱动器 |
| `ctx.llm` | 供应商无关的消息、流与模型适配器接口 |

它把可替换能力定义成三个角色：

1. Service Definition：只声明稳定接口。
2. Service Provider：实现本地、远程或第三方后端。
3. Consumer：使用接口，常见消费者是模型可见工具。

例如文件系统与子进程共享一个 execution world。把 provider 切到远程 E2B 后，Bash、PTY、LSP 等消费者会整体迁移，而不必各自增加一套远程分支。这比在每个工具里判断 `local/remote` 更干净。

## 4. Profile、Bundle 与启动方式

所有正式 Node 应用都经 `dsh` CLI 和命名 Profile 启动。官方 Profile 有：

- `web`：本地 Web UI。
- `headless`：无服务器的一次性运行。
- `sdk`：SDK JSON-RPC 服务。
- `sdk-minimal`：不依赖公共 base 的最小独立 SDK 树。
- `acp`：ACP 自动化服务。

Profile 由有序 Bundle、Profile 自己的 `cordis.patch.yml`、Home 级 patch、命令行 `--patch` 依次叠加。每一行都有稳定 id，上层可替换整行配置或插入新行。Web Profile 支持 live patch reload；stdio/一次性宿主只在启动时装配，避免运行中替换依赖破坏生命周期。

`dsh-base` 是公共能力集合，显式挂载 LLM、Session、Agent、持久化、投影、凭据、权限、沙箱、工具、技能、子智能体、目标、工作流和遥测等插件。也就是说，产品能力不是藏在一个巨大 `AppState` 构造器里，而是一张可检查、可覆盖的装配表。

## 5. Agent Loop

这里的 Step 是“一次模型请求 + 其工具调用”，Turn 是“从接收用户输入到不再欠下一步为止的零到多个 Step”。主流程是：

```text
turn/start（持久）
  -> 从统一 inbox 领取输入
  -> 组装 prompt、tool schemas、runtime context
  -> agent/pre-step（可拦截、改写或拒绝）
  -> step/start（持久）
  -> agent/request / prepareCall
  -> 写 system、user、request header/context
  -> 从日志派生并冻结本次模型历史
  -> llm/stream + 实时 assistant-stream
  -> assistant/message 或 assistant/attempt（持久结算）
  -> tool/call
  -> tools/pre-execute -> execute -> post-execute
  -> tool/result（持久）
  -> step/end（持久）
  -> 有工具结果或新输入则继续下一 Step
  -> agent/turn-stopping
turn/end（持久）
```

几个设计细节值得注意：

- 默认每 Step 最多并行执行 10 个 parallel-safe 工具；exclusive 工具形成顺序屏障。
- 取消时保留已流给用户的文本；尚未派发的工具调用会补写 `ABORTED_BEFORE_DISPATCH` 结果，确保后续历史闭合。
- 失败、重试、取消或流错误会写入 `assistant/attempt` 供回放和诊断，但不进入下一次模型上下文。
- `agent/pre-step`、`agent/request`、`llm/stream` 与工具三个阶段是 waterfall 扩展点，插件必须调用 `next()` 才向下委托。
- 当前没有内建 Turn Budget；无限工具循环需由策略插件在生命周期事件上取消。这是一个真实的现阶段缺口。

## 6. 会话、上下文与持久化

项目最强的一条不变量是：**Model-visible means logged**。凡是进入模型请求的内容，都必须能从 Session 日志重建；运行时会检查这一点。模型历史不是由散落的内存消息数组拼出来，而是统一用 `deriveMessages()` 从事件日志投影。

这带来几个结果：

- fork、resume、转录、遥测和持久化共用同一事实来源。
- 实时流 chunk 只是进程内 UI 增量；完成后紧凑流整体嵌入 `assistant/message`，异常尝试则进入 `assistant/attempt`。
- steering、注入上下文和 inbox 修改也要形成持久事件，重启后行为可解释。
- Prompt 更新区分 in-history 追加与 consolidation，显式考虑供应商 KV Cache 前缀复用。
- `session-projection` 将事件增量折叠为类型化状态，宿主和客户端读取投影，而不是各自重复解析事件。

默认会话持久化是追加式 JSONL（通常为校验和 Zstandard 帧），支持单写者租约、批次 `fsync`、断尾恢复和相邻版本迁移。迁移会发布新的 `session.vN.jsonl[.zstd]` generation，旧 generation 不覆盖、不删除。SQLite 主要用于可选全文会话查询；base 默认 `openAt: never`，并不以 SQLite 作为会话事实日志。

这套方案特别适合可携带、可审计的本地会话，但对 Eden Agent 这种长期运行、并发访问、跨域查询较多的服务端，不能简单得出“JSONL 优于 SQLite”的结论。

## 7. 模型层以及它和 Pi 的关系

Harness 有两类重要 LLM Provider：

- `llm-deepseek`：DeepSeek 官方直连适配器，处理自有流协议、文件/图片、价格等能力。
- `llm-pi-ai`：依赖 `@earendil-works/pi-ai ^0.85.1`，复用 Pi 的多供应商协议、endpoint 和模型目录，并桥接到 `ctx.llm`。

因此准确说法是：**DeepSeek Harness 借用了 Pi 的模型供应商层，但 Agent Loop、Session、插件系统、工具管线、宿主与 UI 都是自己的 Cordis 架构。** `llm-pi-ai` 在 base 中默认休眠；用户配置 provider profile 后才实时注册相应路由。

与 Pi 的典型薄 Harness 相比，DeepSeek Harness 更重：它追求运行时能力可替换、多宿主一致性、持久事件不变量与插件热装配，而不只是一个易读易改的 CLI Agent Loop。

## 8. 权限与沙箱

沙箱接口接收结构化 argv，而不是 shell 字符串。默认 base policy 是 `workspace-write`，本地 provider 按平台选择 Linux bwrap/Landlock、macOS Seatbelt 或 Windows ACL restricted-token 后端。

值得肯定的是：

- 沙箱能力返回 `full` 或 `partial` 的真实 enforcement 状态，消费者可以拒绝不满足要求的 partial。
- 请求受限执行却找不到可用后端时 fail closed，禁止静默降级为无沙箱。
- runner 自身失败和“命令被沙箱正确拒绝”分别归因，避免把基础设施错误冒充普通命令失败。
- 文件、Shell 与子进程策略在每次 capability call 上解析，而不是修改全局 provider 状态。

但官方安全说明也非常直接：尚未做安全审计，不应视为 production-ready；插件、模型生成命令、网络、凭据和文件访问都可能伤害宿主。沙箱与审批只是降险，不是可信隔离边界。

## 9. 与 Eden Agent 的对照

| 维度 | DeepSeek Harness | Eden Agent |
|---|---|---|
| 主体语言 | TypeScript，少量 Rust/native | Rust 主运行时，React/Electron 前端 |
| 组合机制 | Cordis 插件树 + Profile/Bundle/Patch | Rust crates + Server 显式装配 |
| Agent 核心 | `ctx.agents` 接口与可替换 `ctx.agentLoop` | `AgentCore` library 中的强类型 Loop |
| 会话事实源 | 追加式 SessionEvent + JSONL generations | SQLite 事件/状态持久化，事件先持久化再广播 |
| 传输 | Web、framed byte pipes、SDK JSON-RPC/ACP | Axum WebSocket JSON-RPC + Blob；桌面监管双 Server |
| 隔离 | capability seam + 本地/远程 sandbox provider | 权限层、终端边界、进程级双世界隔离 |
| 扩展粒度 | 极细，几乎一项行为一个 npm 包 | crate/service 粒度，编译期约束更强 |

二者方向其实相近：都把 Agent 当可持久运行时，而不是聊天 UI 的附属函数；都有工具权限、沙箱、插件、子智能体、Web/桌面宿主与类型化协议。主要差别是 DeepSeek 把“运行时装配”推到动态插件图，Eden 把“可靠边界”更多放在 Rust 类型、SQLite 与独立进程上。

## 10. Eden Agent 最值得吸收的设计

建议优先吸收思想，不照搬包结构：

1. **正式定义 capability seam**：为文件系统、子进程、模型、Subagent、连接器统一写清 Definition / Provider / Consumer，防止工具直接依赖具体宿主。
2. **引入 Profile/Bundle/Patch 的声明式装配概念**：伊甸园、尘世、headless、desktop 可共享 base，再叠加世界和宿主差异；同时保留 Rust 侧白名单与启动校验。
3. **把“模型可见内容必须可重放”设为可测试不变量**：Eden 已经事件先持久化，可进一步保证 prompt、steering、注入上下文、重试尝试都能从事件重建。
4. **建立统一 Session Projection Registry**：标题、Turn 边界、子智能体目录、用量等都从提交事件增量折叠，避免 RPC/前端分别推断。
5. **明确区分实时流与持久结算**：实时 chunk 只负责观感，最终 message/attempt 才负责恢复、审计与 fork。
6. **将 Prompt Surface 与 KV Cache 规则写进协议**：Prompt 改动何时追加、何时合并、何时使缓存失效，不应隐藏在 provider adapter 的偶然行为里。
7. **生成架构目录与不变量检查**：DeepSeek 对服务图、事件生产者/消费者、配置目录和入口点做自动生成/校验，这类工具对 Eden 扩张后的防漂移很有价值。

## 11. 不建议照搬的部分

- 265 个包过度细分，阅读、构建、版本协调和变更传播成本很高；Eden 没必要把每个小策略拆成 crate。
- 动态插件生命周期、热重载和可逆 effect 很灵活，但异步清理、依赖可用时序和故障定位的心智负担也更大。
- TypeScript 进程内插件组合不等于安全隔离。Eden 现有的 Rust 服务边界、权限决策与双世界进程边界不应为追求灵活性而削弱。
- JSONL generations 很适合日志可移植性，却未必适合 Eden 的多域事务、查询和并发服务需求；更合理的是在 SQLite 事实日志上借鉴不可变事件与迁移语义。
- 项目仍处于 alpha developer preview、未安全审计，当前实现适合作为设计参考，不适合作为生产依赖基座。

## 12. 总体判断

DeepSeek Harness 是一个“插件化本地 Agent 操作系统”方向的项目，架构完整度明显高于普通 Agent SDK。它最成熟的部分是组合模型、事件语义和上下文可重放；风险则是规模、动态性和仍处预览期。

若服务于 Eden Agent，推荐路线不是迁移到 Cordis，而是在现有 Rust 架构上补齐三项：声明式运行 Profile、统一 capability seam 文档/注册机制、模型上下文可重放不变量。这样能获得它最有价值的架构收益，同时保留 Eden 在类型安全、持久服务和进程隔离上的优势。

## 13. 主要源码入口

- `README.md`：项目定位、运行方式、预览状态。
- `docs/architecture.md`：插件、Profile、Turn Flow、Session Log 和 capability seam 总览。
- `packages/bundle/base/cordis.patch.yml`：默认运行时到底挂载了哪些能力。
- `packages/core/agent-loop/`：默认 Agent Loop、请求构造、工具并发与取消。
- `packages/core/session/`、`packages/session/session-persistence-jsonl/`：事件日志和物理持久化。
- `packages/llm/llm/`、`packages/llm/llm-deepseek/`、`packages/llm/llm-pi-ai/`：LLM seam 与供应商适配。
- `packages/sandbox/`、`packages/shell/`、`packages/fs/`：执行边界及消费者。
- `packages/api/`、`packages/sdk/`、`packages/client/`、`apps/desktop/`：协议、客户端与宿主。
- `SAFETY.md`：官方风险边界。
