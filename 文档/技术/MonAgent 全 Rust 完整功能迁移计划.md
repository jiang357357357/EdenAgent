# MonAgent 全 Rust 完整功能迁移计划

状态：等待外部条件  
建立日期：2026-08-19  
目标：在保留全 Rust 单进程架构的前提下，完成归档 Python Server 的产品能力迁移，并补齐长期架构要求的可靠性、安全性和可维护性能力。

## 1. 事实来源

- 旧实现：`D:\Mon\归档\AgentMigrationArchive_20260819`
- 当前实现：`D:\Mon\Agent`
- 长期架构：`文档/技术/MonAgent 全 Rust 服务端长期架构方案.md`
- 外部验收：`文档/技术/MonAgent 真实外部验收手册.md`
- 本文件是功能迁移进度和验收状态的唯一事实来源。
- `MonAgent 全 Rust 迁移执行清单.md` 只记录架构切换历史，不再用于判断功能是否全部迁移。

## 2. 不变约束

1. `AgentCore` 保持宿主无关，不依赖 HTTP、SQLite、具体模型供应商、Electron 或 Mon Core。
2. `Server` 是唯一后端进程，外部副作用、持久化、身份、连接器和宿主业务均归 Server。
3. 不恢复 Python 运行链、sidecar、stdio 私有协议或旧 REST/SSE 兼容层。
4. 前端只通过生成协议对应的 WebSocket JSON-RPC 和 Blob 端点访问 Agent Server。
5. 写文件、命令、外部通信和其他副作用必须经过权限与可恢复的操作日志。
6. 不覆盖工作区中无法确认来源的现有改动，不使用破坏性 Git 操作。
7. 日常开发只做必要的增量检查和定点测试；只有用户明确要求“构建”时才执行完整或 release 构建。

## 3. 完成定义

只有同时满足以下条件，完整迁移才可标记完成：

- 本文件 P0、P1、P2 的所有验收项均完成。
- 归档项目对应的关键行为测试已在 Rust 或前端测试中重建。
- Server 异常终止后重启，不重复执行已经完成的外部副作用。
- 新会话、助手切换、多助手、记忆、自醒和技能在真实 Core 数据下工作。
- 协议生成物、前端适配和 Server 实现一致，不依赖前端伪造目录或状态。
- 增量测试通过，并完成一次由用户明确授权的最终构建与重启验收。
- 技术文档反映真实状态，不再把“架构完成”等同于“功能完成”。

## 4. 阶段计划与验收清单

### M0：迁移基线与验收矩阵

- [x] 盘点归档 Python 模块和 49 个能力测试文件。
- [x] 盘点当前 Rust crates、RPC、工具、连接器和前端适配。
- [x] 区分已迁移、部分迁移、缺失和有意取消的能力。
- [x] 建立长期目标和本持久化计划。
- [x] 把归档测试映射为 Rust/前端验收矩阵，并在后续阶段逐项勾销。

验收：任何功能均能追溯到旧行为、长期架构要求和当前测试。

### M1：角色上下文与默认助手（P0）

- [x] 新增纯 Rust 上下文编译器，白名单提取 participant/profile 字段。
- [x] 编译角色姓名、签名、描述、性格、关系、背景、外貌、世界观和角色提示。
- [x] 编译助手指令、语言要求、工具约束、身份连续性和表达原则。
- [x] 注入当前时间、时区、语言区域、OS、架构和桌面会话事实。
- [x] 注入当前/最近角色动作和可用视觉动作目录。
- [x] 新会话默认绑定 Core 当前助手；Core 暂时不可用时保留明确降级状态。
- [x] 删除把完整 participant JSON 直接放入 prompt 的实现，避免敏感字段泄漏。
- [x] 为上下文编译器和新会话绑定补齐测试。

验收：界面显示哪个助手，模型就以哪个角色身份、语言和指令回复；不得再出现“普拉娜界面、MonAgent 身份”的分裂。

### M2：会话级模型与助手切换（P0）

- [x] 模型绑定从进程全局改为会话级快照。
- [x] 每个助手解析自己的主模型、视觉模型、context window、max tokens 和 reasoning 参数。
- [x] 助手切换只在根回合内创建幂等 durable handoff；旧助手完成当前响应后，下一根 root run 使用新身份和新模型，历史保持不变。
- [x] handoff job 与 requested 事件原子入库；目标 participant、主/角色模型绑定、completed 事件、job 完成和下一输入在同一 SQLite 事务提交。
- [x] 目标模型准备使用进程内会话快照；准备或数据库提交失败时恢复旧模型和旧身份，永久失败留下审计事件后恢复排队输入。
- [x] 已有用户后续输入时由目标助手直接处理；没有后续输入时只入队一条隐藏、瞬态的目标助手接管 run。
- [x] compaction 使用会话实际模型规格，而不是 Server 启动时规格。
- [x] API key 只保留在 Server 安全对象中，不进入事件、prompt 或前端生成类型。

验收：并发会话选择不同助手/模型时互不影响，重启后绑定一致。

### M3：记忆与 Core 上下文同步（P0）

- [x] 记忆默认使用 `agent_character` 作用域并绑定角色 ID。
- [x] 子智能体只能召回，不得创建、更新或删除长期记忆。
- [x] 每轮前按当前角色召回有限数量、有限字符的相关记忆。
- [x] 记忆作为参考事实注入，明确不得覆盖用户当前陈述或系统规则。
- [x] 每轮完成后执行安全、高置信度记忆抽取；过滤凭证和敏感内容。
- [x] 召回或抽取失败不得中止主回复。
- [x] 同步标准化会话、消息、参与者、canonical context 和角色表现状态到 Core。
- [x] Core 临时失败进入持久化重试队列。
- [x] 建立用户/会话级 Core 身份上下文，移除进程全局用户 token 假设。

验收：角色能跨会话记住安全偏好；不同角色记忆不串线；Core 暂时离线后可以补偿同步。

### M4：Companion Director 多助手编排（P0）

- [x] 迁移场景、beat、发言者选择、提及解析和回退计划。
- [x] 单参与者绕过导演模型，多参与者才编排。
- [x] 支持 1→2→1、2→1、1→2 等顺序及所有参与者。
- [x] 支持最近对话、附件摘要和助手间公开回复上下文。
- [x] 限制连续发言、回归次数和未知参与者。
- [x] 持久化 director started/plan/beat/completed/failed 事件。
- [x] 消息保留 speaker 元数据，前端不再依靠兼容推断。

验收：多助手会话的每条发言都能追溯到导演计划和实际角色，重启后历史一致。

### M5：完整 Self-Awake 运行时（P0）

- [x] 建立带版本的请求和决策协议。
- [x] 注入角色、记忆、用户环境、时间、日历、最近日记和触发事件。
- [x] 决策包含 mood、desire、observations、interrupt、action、next wake 和 diary。
- [x] 实现 observe、write diary、remind、create task、ask、safe check、sync context。
- [x] 实现基于价值的通知策略、单次外部联系限制和到期备忘录精确通知。
- [x] 持久化 pending/running/completed/failed 运行和作者快照。
- [x] 根据 `next_wake` 原子地安排下一次任务。
- [x] 增加 hard timeout、outer watchdog、幂等 job identity 和安全 fallback。
- [x] 连接器事件可携带绑定会话的有限历史进入自醒。
- [x] 使用独立工具白名单；禁止 shell、写文件、助手切换和动态技能进程工具进入自醒运行时。

验收：自醒不是普通聊天提示，而是可恢复、可审计、可再调度的后台状态机。

### M6：副作用日志与崩溃恢复（P0）

- [x] 为每次工具调用生成稳定 operation ID，贯穿权限、工具、事件和外部请求。
- [x] 新增 operation journal：planned、authorized、started、committed、failed、unknown。
- [x] 工具执行前持久化 planned/started，成功后先持久化 committed 再向模型返回。
- [x] 重启恢复时复用原 operation ID；committed 操作直接复用结果。
- [x] 对文件写入、邮件、QQ、联系人、连接器命令、备忘录和任务实现幂等适配。
- [x] 无法确认外部提交状态时标记 unknown 并请求用户决策，不自动重放。
- [x] 重复调度不会把已经 claimed 的 job 重置为 scheduled，避免并发重复执行。

验收：在工具执行前后人工终止 Server，重启不会重复产生外部副作用。

### M7：上下文、压缩、缓存与流恢复（P1）

- [x] 过滤孤立工具结果、失败助手消息和不完整工具历史。
- [x] 长文本与长工具结果有界截断，保留尾部和 continuation 元数据。
- [x] 技能快照进入持久化模型上下文，旧轮次在压缩前保持稳定。
- [x] 工具循环中达到阈值时可压缩并继续同一 run。
- [x] token breakdown 覆盖身份、系统、技能、工具和历史。
- [x] 实现 prompt fingerprint、cache epoch、失效原因和会话 cache key。
- [x] 流建立后的 EOF/chunk 错误可撤回 provisional text 并安全重试。

验收：超长工具会话能够连续运行，重试不会留下重复或半截正文。

### M8：技能与连接器平台（P1）

- [x] 技能安装支持 `SKILL.md`、scripts、references、assets、tests、tools 和允许的 agent 元数据。
- [x] 校验符号链接、危险路径、未知工具和不安全文件。
- [x] preview 单次、按用户归属；更新带内容哈希和并发修改保护。
- [x] profiles、工具依赖、权限和 root/subagent 策略在运行时生效。
- [x] watcher 刷新技能目录并生成稳定 inventory/snapshot。
- [x] 技能代码工具使用版本化 manifest、JSON stdin/stdout、输出 schema、自测缓存、OS 沙箱和 `skill.process` 权限；无沙箱时不注册。
- [x] 生成技能支持 user/project 作用域、完整包创建、文件增删、预览哈希、原子替换与同级备份。
- [x] 动态技能工具按 `user_chat/self_awake/subagent` 二次隔离；子智能体只获得其显式技能命名空间内的工具。
- [x] Server 从 `connectors/manifests` 生成公共目录和 action/query/event schema。
- [x] 注册前拒绝未知或无 manifest 的连接器，执行前校验 payload。
- [x] 实现 manifest revision 热更新和连接器 worker 故障隔离。
- [x] 前端删除硬编码连接器目录。

验收：新增合规技能或连接器不需要修改前端硬编码；单连接器故障不拖垮 Server。

### M9：子智能体、Web 与工作区（P1）

- [x] 子智能体定义支持角色、模型、reasoning、技能、只读策略和预算。
- [x] 最大深度、并发、存活时间、turn/tool/token/费用预算持久化并强制执行。
- [x] 子级只能收窄父级权限，不能扩大权限或操作长期记忆/角色表演。
- [x] 支持 parent history fork、完成通知、等待、批量聚合和重启续跑。
- [x] Web 搜索恢复结构化供应商、去重排序、批量查询、缓存和会话引用。
- [x] Responses 原生 Web Search 引用去重后保留并补入最终文本，避免供应商 citation 丢失。
- [x] Web 执行任务可取消、限制总超时，并继续阻止 localhost/私网 SSRF。
- [x] 提供经用户授权的安全 workspace 切换/外部根目录机制。

验收：复杂研究任务可安全委派，搜索结果稳定可引用，工作区切换不能越权。

### M10：会话、协议与前端收口（P1）

- [x] 自动生成并清洗会话标题。
- [x] 删除会话真正删除本地状态和对应 Core 投影；运行中会话拒绝删除。
- [x] `session.list` 默认不返回 closed，若保留归档则使用独立参数/接口。
- [x] 事件和消息实现服务端 cursor 分页。
- [x] participant 更新在运行中拒绝，并返回明确状态。
- [x] 暴露 steer/queued follow-up，行为与 AgentCore queue 一致。
- [x] 生成协议成为唯一事实来源，删除手写重复类型和兼容字段。
- [x] 删除前端伪造的技能详情、连接器能力和自醒/director 数据。

验收：刷新、重启和大历史下 UI 状态与 Server 一致。

### M11：可观测性、迁移与发布验收（P2）

- [x] `/readyz` 检查数据库、后台调度、模型配置和必需宿主能力。
- [x] 增加活跃会话、队列、首 token、turn、工具、provider 重试和数据库延迟指标。
- [x] 日志包含 session/turn/operation/job/connector correlation ID，且不泄露凭证。
- [x] 扩展旧数据迁移：记忆、自醒、director、权限、连接器、技能和角色状态。
- [x] 每种迁移可重复执行且不会产生重复记录。
- [x] 重建归档关键行为测试矩阵。
- [x] 重新生成 typed RPC，并完成 Rust workspace、Web、Desktop、开发脚本增量测试。
- [x] 完成真实 Core/模型基础联调、强制终止恢复和 Rust Server 重启验收。
- [ ] 获得用户明确授权后执行最终完整构建。
- [x] 更新架构、运行、故障恢复和开发文档。

验收：项目重启可正确运行，迁移数据完整，健康状态可诊断，测试与文档吻合。

## 5. 当前执行位置

当前阶段：M11 外部环境与发行验收。  
已完成阶段：M0–M10；M11 的代码迁移、协议生成、本机自动化回归、真实 Core/模型基础联调和 Rust Server 重启验收已完成。  
当前验证进度：归档非测试模块复核后，补齐技能代码工具完整包、沙箱执行、动态刷新与 profile 隔离，恢复会话环境/IANA 时区/农历节日/Open-Meteo，修正 claimed job 幂等调度、Responses 原生引用、流重试消息身份，并删除模型可任意调用 Core `/api/` 的宽口径工具。针对真实回合暴露的 SQLite `database is locked`，文件数据库改为单一共享连接串行化运行时写入，并增加 64 路并发回归测试。进一步发现登录后的 Core 凭据原先只进入模型和 CoreSync、未进入 19 个 Host 工具；现改为仅内存的默认/会话级凭据注册表，`model.catalog/select` 原子刷新模型、CoreSync 与 Host，删除会话时清理绑定。Windows workspace 当前发现 232 项 Rust 测试：常规运行 229 项并全部通过；3 项真实外部测试默认忽略，其中贴纸往返已显式运行通过，邮件和 QQ 因当前环境未配置而未触发。Web 142 项、Desktop 122 项、进程运行器 5 项、OpenTTD 启动器 5 项通过，另 4 项 Linux 专用测试按平台跳过；typed RPC、TypeScript、lint 和 Web 启动冒烟均通过。OpenTTD 启动器现会把仓库内受管 GameScript/AI 文件幂等安装到持久内容目录，不再要求人工复制桥接源码。真实 Mon Core 登录、2 项模型目录、`opencode_go/mimo-v2.5` 流式回合和记忆提取完成；会话级 `list_character_actions/list_character_stickers`、全局默认凭据下的 `list_assistants`、角色动作切换，以及贴纸创建/发送 canonical UI event/删除的完整往返均真实执行成功。Core 对成功 DELETE 返回的 `204 No Content` 现统一归一为 JSON `null`，并由假服和真实集成测试共同覆盖。通过 `monpm` 正式停止/启动 Rust Server 后，13 个活动会话、73 个工具和空 operation journal 均正确恢复，`/healthz`、`/readyz`、`/metrics` 全部通过。  
下一步：在对应外部环境完成 Linux OpenTTD 生命周期与真实 Admin Port/GameScript 联调，以及通知、QQ、邮件等真实外发副作用验收；当前机器没有 WSL 发行版、Docker 或 OpenTTD，真实 Core 的邮件账户 `enabled=false/ready=false/password_set=false`，QQ Bot 数量为 0。最终完整/release 构建仍需用户明确说“构建”。这些是环境/发布验收，不再是 Rust 代码迁移缺口。

## 6. 续做规则

每次继续迁移时按以下顺序恢复现场：

1. 阅读本文件的“当前执行位置”。
2. 查看 `git status`，保留未确认来源的改动。
3. 完成当前最小验收单元，不跨阶段制造半成品依赖。
4. 使用 `apply_patch` 修改文件。
5. 默认只运行与改动直接相关、复用缓存的增量 Cargo/npm 检查；完整或 release 构建仍需用户明确说“构建”。2026-08-20 用户已授权本轮增量编译、类型生成、测试和最终重启验收。
6. 更新本文件复选框和“当前执行位置”。
7. 所有完成条件满足前，不把长期目标标记为 complete。

## 7. 进度日志

- 2026-08-19：完成归档与 Rust 能力审计，确认架构迁移完成但功能迁移不完整。
- 2026-08-19：建立长期迁移目标和本计划；开始 M1。
- 2026-08-19：完成 M1。Rust 上下文编译器改为白名单角色上下文，加入环境、语言、角色动作和有界角色记忆；新会话自动绑定 Core 当前助手。`mon-agent-app` 4 项测试、前端 2 项定点测试和 TypeScript 类型检查通过。
- 2026-08-19：完成 M2。Provider 改为持久化的会话级主/视觉模型绑定；文本模型收到图片时先走隔离视觉分析，再将文本结果交给主模型；compaction 使用会话实际规格；助手/模型切换在有排队或运行回合时拒绝，并在生效前写入事件。Provider/App/Store 共 23 项定点测试通过，Server 5 项 RPC 测试通过（测试进程在结果输出后未主动退出，需在 M11 排查测试句柄泄漏）。
- 2026-08-19：完成 M3。角色记忆强制使用 `agent_character` 作用域，子智能体只获得搜索工具且运行时再次禁止写操作；主回合增加高置信度自动抽取、去重和中英文凭证过滤。新增 `mon-agent-core-sync`，使用会话/用户身份映射、仅内存凭证和 SQLite outbox 同步会话、消息、参与者、canonical context 与角色表现状态；失败指数退避，重启后可继续。App/CoreSync/Host/Store/MultiAgent 共 22 项定点测试通过，Server 增量检查通过。
- 2026-08-19：完成 M4。Rust App 新增隐藏 Director 场景/执行/beat 协议、名称提及回退、严格计划归一化和单参与者快速路径；多参与者在一个用户消息后按 beat 继续公开上下文，限制连续/回场/未知角色，并持久化 started/plan/speaker/completed/failed 事件。每个角色使用独立且可重启恢复的模型绑定；助手消息写入安全 speaker/orchestration 元数据，前端投影直接消费。App/Provider/Store/CoreSync 共 34 项定点测试和 TypeScript 类型检查通过。
- 2026-08-19：完成 M5。Self-Awake 从普通后台聊天输入改为 `self-awake.v1` 状态机：请求注入角色、记忆、环境、日历、日记、触发事件及有界连接器历史；决策经过动作白名单、长度/时间界限和安全 fallback。SQLite 持久化 pending/running/completed/failed、作者快照、日记和单次通知意图，并在同一事务完成当前 job 与下一次唤醒；任务/提醒/问题采用稳定幂等键。到期备忘录强制保留原始标题与详情，价值型通知经会话级 Core 身份和 durable outbox 单次投递；模型执行有 10–900 秒 hard timeout，外层 job lease 与 input recovery 负责 watchdog。Server 增量检查及 Store/CoreSync/App 5 项 Self-Awake 定点测试通过。
- 2026-08-19：完成 M6。每次工具调用由 session/turn/tool-call 确定性生成 operation ID，Approval hook 在权限前写 planned、放行后写 authorized/started，工具成功或失败后先写 committed/failed 再返回模型；已提交结果在恢复时直接复用。Server 重启把遗留 started 转为 unknown，生成 `operation.review_required`，并通过生成协议的 `operation.list/resolve` 接受 retry/abandon，绝不自动重放未知副作用。Core 邮件/QQ/contact 请求和连接器 payload 透传 operation ID，文件、命令、备忘录和任务由统一 journal 或专用唯一键保护；敏感参数在 journal 中递归脱敏。Server 增量检查、前端类型检查、AgentCore 14 项测试及 Store/Sandbox 定点崩溃恢复测试通过。
- 2026-08-19：推进 M7。新增统一模型历史清洗，过滤失败助手消息、孤立工具结果和不完整工具调用历史；长正文与工具结果按独立上限截断，保留尾部及 `contextTruncation` continuation 元数据。会话重建和压缩估算统一使用清洗结果。新增身份/系统/技能/工具/历史 token breakdown、稳定规范 JSON prompt fingerprint、cache epoch/失效原因/变更组件，并按角色会话持久化 cache state。技能提示以 `context.skill_snapshot` 固化到事件历史；当前时间移出可缓存系统前缀，改为每轮非持久化运行环境消息。Server 增量检查、AgentCore context/compaction 定点测试及 App 12 项测试通过；尚待流中断恢复、工具循环内压缩和剩余定点测试。
- 2026-08-19：完成 M7。新增 `RuntimeLoopHooks`，在每次模型续轮前按完整 prompt（身份、系统、技能、工具、历史）检查预算，超阈值生成检查点并在同一 run 内携带摘要和新增工具结果继续；后续轮次复用已压缩上下文。技能快照单次持久化并在重建/压缩前稳定回放。缓存元数据补齐 session+assistant cache key、fingerprint、epoch、失效原因并透传供应商 payload；OpenAI usage 统一为 input/output/cacheRead/cacheMiss/totalTokens。Chat Completions 与 Responses API 均支持流后 EOF/chunk 安全重试，重试前发出 `stream_reset` 清空前端 provisional parts；工具调用开始后禁止自动重放。补齐 Luna Responses reasoning/text/usage、工具调用回放、compaction/custom context 与缓存键测试。AgentCore 29 项、App 14 项、Provider 18 项定点测试，Server 增量检查、前端类型检查及 stream recovery 测试均通过。
- 2026-08-19：完成 M8。技能安装由单文件升级为完整、原子的软件包快照，允许 `scripts/references/assets/agents`，拒绝符号链接、隐藏逃逸路径、原生可执行文件、未知工具和非法 profile/permission 声明；preview 按本地能力主体单次消费，Git 临时检出先固化，更新用包哈希阻止并发覆盖。运行时按 `user_chat/self_awake/subagent` 强制 profile，缺失工具的技能不可加载且不进入 inventory；权限声明不授予能力，实际工具仍经过宿主权限策略。技能 watcher 原子刷新目录并同步 root/subagent 新回合提示词，已开始的回合保持快照。修复三个乱码且无效的连接器 manifest，Server 由 manifest 生成公共目录和 event/query/action schema，注册拒绝未知类型，settings/query/action payload 在执行前校验；manifest revision 热更新会重启隔离 worker，配置变更与 worker 异常也会被 supervisor 单独回收。前端技能详情与连接器目录改为消费生成 RPC，删除硬编码。技能 7 项、连接器 4 项测试、Server 增量检查、前端类型检查和 Rust 格式检查通过。
- 2026-08-19：完成 M9 子智能体单元。新增内置/用户/项目 TOML 角色目录、模型与 reasoning 覆盖、按 `subagent` profile 校验并固化的技能正文快照、机械工具过滤和不可扩权的嵌套策略；深度、全局并发、存活时间、turn/tool/token/费用预算全部写入 SQLite 并在运行时强制执行。父历史 fork、durable mailbox 完成通知、单个/批量等待、batch ID 聚合、上下文 checkpoint 和重启续跑均已实现。修复嵌套同名路径、排队任务中断、最终回复后崩溃丢结果和 SQLite 并发写锁问题；预算更新改为原子 SQL。MultiAgent 10 项、Skills 8 项、Store 14 项测试及 Server 增量检查通过。
- 2026-08-19：完成 M9 Web 单元。`web` 统一为严格的 search/open/find 协议，支持 Brave、Exa、Tavily、SearXNG、Bing 和 DuckDuckGo，最多四查询并发、部分成功保留、相关性排序、URL/标题去重、同域限流、短期缓存以及 session-scoped search/page 引用。公开页面按流限制字节、清洗 HTML 并支持引用内查找。Rust 内直接使用可取消的 Tokio 请求任务；总 deadline 覆盖 DNS、连接、手动重定向和正文流。每一跳拒绝用户信息、localhost、私网及特殊用途 IPv4/IPv6，解析全部地址后固定连接到已验证公共 IP，跨源重定向剥离敏感头且禁用系统代理，防止 DNS 重绑定、重定向和代理型 SSRF。Host 12 项测试及 Server 增量检查通过。
- 2026-08-19：完成 M9 工作区单元。新增 SQLite 持久化 current/pending workspace 状态、根智能体专用且需要授权的 `switch_workspace`、显式目录选择 RPC/桌面入口，以及仅在会话输入、子智能体和后台命令全部空闲后提交的 catalog worker。切换时原子重载项目技能和子智能体定义，运行中子智能体继续使用创建时工作区快照；失败回滚运行时配置并持久化失败事件。原生工作区工具动态跟随当前根目录；新增有界、只读、逐次授权且拒绝路径逃逸/符号链接的 `external_ls/read/find/grep` 和 `file_locator` 角色。Windows 路径去除设备前缀。Server 7、Store 15、Skills 9、MultiAgent 10、Workspace 3 项测试，前端 typecheck 和 Desktop 122 项测试通过。
- 2026-08-19：推进 M10 源码迁移。新增会话标题所有权/后台生成与超时清洗、active-only 列表、真实级联删除及 Core 投影补偿、删除 tombstone、事件/消息 cursor、参与者原子空闲检查、AgentCore steer/follow-up 接线及忙碌时文字后续消息入口。self-awake/director 改读真实 SQLite/事件投影，删除旧 Python orchestrator 和 legacy message 前端兼容层；技能、连接器、workspace、工具、模型、问题和子智能体 RPC 改为 Rust 生成类型，问题“暂不处理”改为持久化 rejected。协议源已升级 v2；按用户要求尚未运行类型生成、编译、测试或重启，M10 复选框需在授权验证后确认。
- 2026-08-19：推进 M11 源码迁移。新增数据库/模型/工具/后台 worker readiness、Prometheus 队列与延迟指标、持久单调 turn/tool/provider 计数，以及 session/turn/operation/job/connector correlation 日志；权限请求日志参数改为递归脱敏。Server 新增长期持久日志：控制台与私有文件同步输出、按大小有限轮转、写入前统一凭据脱敏，Desktop 将日志目录固定在用户私有数据目录。旧 MonCore SQLite 导入从会话扩展到记忆、工作记忆、备忘录、自醒/日记、Director、连接器事件、技能元数据、角色状态和旧权限模式，并以 ledger 保证幂等。连接器凭据、待执行任务、旧技能和 takeover 权限只记录不激活；新增 readiness/metrics 迁移审计。建立《MonAgent 归档行为验收矩阵》，逐项映射全部 49 个归档测试文件并列出剩余验证缺口。遵守用户要求，本轮未运行构建、测试、类型生成或重启。
- 2026-08-19：补齐归档矩阵的剩余已知源码缺口。Core 工具恢复严格 schema、会话级助手交接、QQ/邮件通知、角色动作与贴纸持久事件；MediaService、权限、手动压缩 no-op/失败、配置解析、Lichess HTTP/NDJSON/棋局状态和 OpenTTD framing/action/ack 均新增定点测试源码。Connector 工具改为 manifest 生成 schema 和无 settings 的有界模型摘要；reconciliation 增加单飞锁和 generation 防止旧 worker 删除新 worker。Linux OpenTTD 启动器新增真实生命周期测试源码，注册表与 Rust 连接器统一验证 PID、启动时钟、实际可执行文件和启动目标。仅执行 `git diff --check` 与 UTF-8 JSON 静态解析，未运行构建、测试、类型生成、启动或重启。
- 2026-08-19：完成无构建文档收口。纠正架构执行清单“完成”与完整产品验收的含义，标记旧 Python 设计 QA 为历史证据，新增 Electron/Core 当前职责边界和《MonAgent Rust 运行与故障恢复手册》，记录协议生成顺序、持久路径、readyz/metrics、operation unknown 审计、重启恢复、OpenTTD Linux 边界与分层验收命令。静态审计确认 Rust 协议源为 v2、检入生成客户端仍为 v1；按约定未手工修改生成物，列为构建授权后的首个阻断项。
- 2026-08-19：修正助手切换语义。归档 Python 的真实行为是“旧助手完成当前响应，目标助手在独立下一根 root run 接管”，而不是运行中直接覆盖 participant。Rust Core 工具现在原子写入幂等 `assistant.handoff` job 和 requested 事件；job gate 阻止排队输入抢跑。Worker 等当前 root/子智能体退出后准备目标 actor/session 模型，并用可回滚的进程内会话模型快照隔离失败；Store 在单一事务中校验 durable target、更新 participant、替换两类模型绑定、写 completed 事件、完成 job，并在“恢复既有用户输入”和“创建唯一隐藏接管输入”之间二选一。永久失败记录 `session.assistant_handoff.failed` 并保持源身份。补充 Store/Provider/App/前端契约测试源码；未执行构建、测试、类型生成或重启。
- 2026-08-20：收到增量编译授权后完成归档非测试模块复核。新增技能 `tools/*.json` 代码工具、沙箱执行、自测、权限、动态刷新、完整生成包与 user/project 原子更新；工具按 root/self-awake/subagent profile 和技能命名空间双重隔离。恢复会话环境、IANA 时区、农历节日与天气；修复 claimed job 重复调度、Responses 原生引用、助手 handoff 回滚和前端流重试身份。移除任意 `mon_core_request`，只保留强类型 Core 工具。重新生成 typed RPC。Rust workspace 229 项、Web 142 项、Desktop 122 项、进程运行器 5 项、OpenTTD 启动器 4 项全部通过；4 项 Linux 专用测试跳过。TypeScript、lint、Rustfmt 与 Web 开发启动冒烟通过。
- 2026-08-20：完成 Windows 运行与重启验收。真实 Core 模型回合首次暴露 SQLite 并发写锁，Store 文件数据库改用单一共享连接，并增加 64 路并发写入回归测试；修复后真实 `opencode_go/mimo-v2.5` 回合完成，未再出现锁错误。强制停止端口进程并在不重新编译的情况下启动同一 Rust 可执行文件，协议 v2、Server/Core 1.8.0、13 个活动会话、73 个工具、Core 模型目录和空 operation journal 均恢复；数据库、worker、模型、工具和 workspace readiness 全部通过，队列、活动输入、子智能体、作业、connector 与 CoreSync backlog 均为 0。验收产生的 2 个临时会话已删除。剩余项仅为 Linux OpenTTD/Admin Port/GameScript、真实外发副作用和经明确授权的最终 release 构建。
- 2026-08-20：真实 Core 工具验收推翻了“模型可用即工具可用”的错误假设。`model.catalog/select` 过去只配置 Provider 与 CoreSync，启动时没有 `MON_CORE_TOKEN` 时，19 个强类型 Host 工具会永久返回 `core_unconfigured`。Host 现使用共享的仅内存凭据注册表，会话绑定覆盖默认绑定，已有工具实例即时生效，删除会话时清理；全局刷新同时 hydrate CoreSync。新增隔离/回退/清理单元测试。增量构建后由 `monpm stop/start agent-api` 正式替换服务，真实模型事件证明会话级动作/贴纸查询和全局默认助手查询均执行成功、`isError=false`；临时会话与操作日志已清理，readiness 恢复 200。
- 2026-08-20：补做真实 Core 只读端点审计。Host 使用的邮件状态、QQ Bot 列表、自醒日记三条精确路径均以当前用户 Token 返回 HTTP 200；当前没有 QQ Bot，邮件 SMTP 未启用且无密码，所以真实 QQ/邮件发送不具备验收前置条件。Linux 探测同样确认本机只有未安装发行版的 `wsl.exe` 和 Git Bash，没有 Docker/OpenTTD；Linux `/proc` 进程身份、Admin Port 和 GameScript 不能在此 Windows 环境伪验收。`monpm` 最终状态为 running/healthy/ready、监督重启计数 0，端口服务 health/ready 均为 200。
- 2026-08-20：闭合真实角色写入与贴纸往返。角色动作切换经真实 Core 成功并持久化最终动作事件；新增默认忽略的真实 Core 贴纸集成测试，使用实际 Host 工具完成创建、发送 canonical `character.sticker.sent` 事件和删除，失败时也会清理本轮制品。测试暴露 Core DELETE 的合法 `204 No Content` 被强制按 JSON 解析的问题，现将所有成功空响应归一为 `null`，并把假 Core DELETE 改为 204 形成常规回归覆盖。Windows workspace 重新发现 230 项测试，常规运行 229 项全部通过、1 项真实外部集成默认忽略且已显式运行通过；Rustfmt 通过。服务经 `monpm` 停止、增量测试和重新启动后恢复 healthy/ready，监督重启计数仍为 0。
- 2026-08-20：把最后的真实外发环境门槛固化为可执行验收。Host 新增默认忽略的真实邮件和 QQ 测试；二者都要求 `MON_TEST_ALLOW_EXTERNAL_SEND=I_UNDERSTAND_THIS_SENDS_A_REAL_MESSAGE`，邮件要求单一已核对收件人并拒绝任何 SMTP rejected recipient，QQ 要求显式 Bot/目标且只有 BotCore/NapCat `delivery.confirmed=true` 才通过，不能把 queued 当成成功。新增《MonAgent 真实外部验收手册》，记录凭据保护、前置条件、精确命令、OpenTTD Linux 六步闭环和 Server 恢复要求。Host 常规测试 29 项通过，3 项真实外部测试按设计忽略；本机 Core 仍没有 QQ Bot，邮件仍未启用，因此没有触发真实外发。
- 2026-08-20：复核 OpenTTD 真实启动前置条件时发现桥接源码只存在于仓库，启动器没有安装它，真实游戏可能始终无法宣告 bridge ready。新增 `install-bridge` helper，把 4 个受管 GameScript/AI 文件复制到持久 `game/MonAgentBridge` 与 `ai/MonAgentCompany` 目录，内容相同则不重写，也不删除同目录用户文件；Linux 启动器在创建实例配置前自动执行。新增跨平台幂等/保留用户内容测试，Windows 启动器测试现为 5 项通过、4 项 Linux 生命周期跳过。
- 2026-08-20：第三次重新读取外部验收条件，而非沿用历史结论。Core 邮件状态仍为 `enabled=false/ready=false/password_set=false`，当前用户 QQ Bot 总数与在线数均为 0；`HKCU\Software\Microsoft\Windows\CurrentVersion\Lxss` 不存在，WSL 发行版为 0；系统命令、Steam/Program Files 常见路径和卸载注册表中均未找到 OpenTTD。Rust Server 同时保持 running/healthy/ready。由于安装 Linux/WSL/OpenTTD、配置外部账号/收件目标和执行 release 构建都需要用户提供环境或明确授权，长期目标进入“等待外部条件”，不再自动重复编译、探测或发送。
