# MonAgent 归档行为验收矩阵

状态：等待外部条件  
基线：`D:\Mon\归档\AgentMigrationArchive_20260819`  
用途：把归档 Python Server 的 48 个测试文件和 1 个 OpenTTD 启动测试逐项映射到全 Rust 架构；本表描述行为去向，不把“存在源码”当作“已经运行通过”。

## 状态说明

- **源码覆盖，待复验**：初始源码审计标签；是否已运行以紧随其后的“自动化复验记录”为准。
- **Linux 源码覆盖，待 Linux 复验**：Linux 专用实现和真实进程测试源码已存在，但当前 Windows 会话没有执行它。
- **部分覆盖**：产品路径已存在，但归档中的关键异常、协议或边界测试尚未在新架构中完整重建。
- **有意替代**：旧 sidecar、REST、Python host 等机制被长期架构替代，验收对象改为等价产品行为。
- **退出边界**：旧能力不再属于 Agent Server，必须由明确的新宿主边界承担。
- **缺口**：长期方案仍需要实现或补齐可验证证据。

## 自动化复验记录（2026-08-20）

- Windows 上共发现 232 项 Rust 测试；常规运行 229 项并全部通过，3 项真实外部测试默认忽略。其中贴纸集成测试已显式运行通过；邮件和 QQ 测试需要真实目标及不可逆外发二次确认，当前环境未触发。Store 的 27 项中包含 64 路并发文件数据库写入回归测试，Host 的常规测试包含动态 Core 凭据隔离/回退/清理及 Core 204 空响应测试。
- typed RPC 已由 Rust v2 源重新生成；TypeScript 检查通过。
- Web 142 项、Desktop 122 项、进程运行器 5 项、OpenTTD 启动器 5 项通过；OpenTTD 的 4 项 Linux 专用生命周期测试按平台跳过。启动器现幂等安装仓库内的 GameScript/AI 桥接文件并保留同目录用户内容。
- Rustfmt、lint（0 error/0 warning）和 Web 开发启动冒烟通过。
- 真实 Mon Core 登录与模型目录读取成功，`opencode_go/mimo-v2.5` 流式回合完成；首次联调发现并修复 SQLite 并发写锁，修复后未复现。随后发现登录凭据没有注入 Host 工具，修复为仅内存的默认/会话级动态注册表；真实 `list_character_actions`、`list_character_stickers` 和 `list_assistants` 工具事件均成功结束。角色动作切换及贴纸创建/发送 canonical UI event/删除的真实往返也已通过；期间发现并修复 Core 成功 DELETE 返回 204 空正文时的 JSON 解析错误。
- Host 使用的真实邮件状态、QQ Bot 列表、自醒日记路径均返回 HTTP 200；当前 Core 的邮件 SMTP 未启用/未配置密码，QQ Bot 列表为空，因此没有合法的真实发送目标。
- 真实邮件与 QQ 各有默认忽略、二次确认门控的传输验收测试：邮件要求 SMTP 无拒收，QQ 要求 Core 准入通过且 BotCore/NapCat 回执 `delivery.confirmed=true`；当前环境未满足前置条件，未发送测试消息。执行要求见《MonAgent 真实外部验收手册》。
- 强制停止并在不重新编译的情况下重启 Rust Server 后，协议 v2、Server/Core 1.8.0、13 个活动会话、73 个工具、默认模型和空 operation journal 均恢复；`/healthz`、`/readyz`、`/metrics` 通过，所有运行队列为 0。
- 因此，下表标为“源码覆盖，待复验”的 Windows 自动化部分均已复验通过；仍未闭合的只有通知/QQ/邮件等需要已配置目标的真实外发、Linux OpenTTD/Admin Port/GameScript 和最终发行构建。

## 逐文件矩阵

| # | 归档测试 | 长期架构中的行为去向 | 当前证据 | 状态 |
|---:|---|---|---|---|
| 1 | `test_app_state_hydration.py` | 会话级 Core 身份、默认助手和模型绑定，不再使用 Python 全局 hydration cache | `mon-agent-app/prompt.rs`、`mon-agent-provider` 会话绑定测试、`default-assistant-session.test.mjs` | 源码覆盖，待复验 |
| 2 | `test_assistant_tools.py` | 助手切换成为旧 root run 结束后的 durable handoff；目标助手以相同历史启动独立下一 run，子智能体禁止切换 | Core handoff 调度测试；Store requested/job 与 participant+binding+completed+next-input 原子事务测试；Provider 会话模型快照回滚测试；App 隐藏瞬态接管消息测试；MultiAgent root-only policy | 源码覆盖，待复验 |
| 3 | `test_camera_capture.py` | Rust MediaService 持久化请求/响应，Electron 提供图像，Provider 决定直传或视觉回退 | MediaService 参数拒绝/有效 Blob/拒绝生命周期测试、`camera-capture.test.mjs`、Provider 视觉测试 | 源码覆盖，待复验 |
| 4 | `test_character_main_agent.py` | Rust prompt 编译、角色记忆、会话模型、技能快照和同 run 压缩 | App prompt/memory/runtime tests、Provider model-binding tests | 源码覆盖，待复验 |
| 5 | `test_companion_director.py` | Rust Director 生成 scene/execution/beats，并持久化 speaker/orchestration | `mon-agent-app/director.rs`、App 多参与者测试、3 个 Director 前端测试 | 源码覆盖，待复验 |
| 6 | `test_config.py` | Clap/env、`.monconfig` Node 加载器和会话级 Core 配置替代 Python settings | Rust Args typed/invalid tests、`monconfig.test.mjs`、`Script/Project/dev.mjs`、Provider 安全配置测试 | 源码覆盖，待复验 |
| 7 | `test_connector_tools.py` | manifest 驱动 catalog/schema，注册、查询和动作统一走 Rust connector service | Manifest 生成工具 schema/无 settings 列表测试、Server catalog/create/update RPC、动作与查询精确校验 | 源码覆盖，待复验 |
| 8 | `test_connector_workers.py` | 同进程 Tokio worker 隔离、manifest revision 重启和 supervisor reconciliation | Manifest reload、reconcile single-flight、generation 防旧 worker 误删、配置变更/故障隔离测试 | 源码覆盖，待复验 |
| 9 | `test_context_manager.py` | AgentCore canonical context 清洗、截断、压缩与技能快照 | AgentCore context/compaction tests、App skill snapshot/loop compaction tests | 源码覆盖，待复验 |
| 10 | `test_core_context.py` | CoreSync durable outbox、canonical context、participants 和 character state | `mon-agent-core-sync` 4 项测试、App prompt 环境测试 | 源码覆盖，待复验 |
| 11 | `test_director_run_persistence.py` | Director 状态使用 canonical session events，并由 CoreSync 投影 | App Director events、CoreSync projection tests、旧数据 director event import test | 源码覆盖，待复验 |
| 12 | `test_display.py` | Python 终端 SVG/table renderer 不进入本地 Agent 服务；诊断改为 tracing、`/readyz`、`/metrics` 和 Web UI | readiness/metrics 源码与前端 UI | 有意替代 |
| 13 | `test_environment_time.py` | 会话环境持久化；白名单事实、IANA 时区、locale、农历和附近节日由 Rust 注入，坐标不进入 prompt | Environment 4 项、Store 会话环境、App prompt、自醒环境及前端传递测试 | Windows 自动化验证通过 |
| 14 | `test_external_files.py` | 旧版任意绝对路径/符号链接读取被取消；改为逐根授权、有界、拒绝逃逸的外部读取 | `mon-agent-workspace` 3 项测试 | 有意替代，安全语义更严格 |
| 15 | `test_lichess_connector.py` | Rust 原生 Lichess event stream 与 Bot API action | NDJSON 分帧、稳定事件 ID、棋局/FEN/合法走法、动作安全路径/表单、本地 TCP 假服 Bearer HTTP 测试 | 源码覆盖，待复验 |
| 16 | `test_llm_sync.py` | AgentCore wire types和 Rust Provider 直接序列化 tool/thinking/model options | Provider payload、Responses/Chat tests，AgentCore wire-shape tests | 源码覆盖，待复验 |
| 17 | `test_logging.py` | 统一 tracing correlation/redaction；Server 同时输出控制台和私有持久日志，并按大小保留有限备份 | `rust/observability.rs` 轮转/脱敏测试、session/turn/operation/job/connector tracing 源码 | 源码覆盖，待复验 |
| 18 | `test_manual_compaction.py` | `session.compact` RPC 驱动 AgentCore compaction，并持久化 checkpoint | AgentCore 无旧历史 no-op、App 手动 no-op/失败终态、同 run compaction、RPC durable queue 测试 | 源码覆盖，待复验 |
| 19 | `test_memo_schedule.py` | 备忘录和定时任务写入 SQLite jobs，不再写 MonOS 临时请求文件 | Store durable jobs/memo/self-awake tests | 有意替代，源码覆盖待复验 |
| 20 | `test_memory_tools.py` | 角色域记忆、root-only 写入、安全过滤和有界召回 | App memory/prompt tests、Host policy tests | 源码覆盖，待复验 |
| 21 | `test_model_stream.py` | Rust Provider 覆盖 Chat/Responses 流、重试、撤回、tool/reasoning/usage/cache 和原生 Web citation | Provider 20 项、AgentCore events、`stream-recovery.test.mjs` | Windows 自动化验证通过 |
| 22 | `test_mon_tools.py` | Core business tools、通知、QQ、邮件、角色动作、贴纸、天气、timer 由 Rust Host 提供；取消任意 Core 路由入口 | 严格 schema/超时/顺序、动态默认/会话 Core 凭据、假 Core HTTP、真实动作/贴纸/助手查询与角色动作切换、通知 channel ID、QQ 默认与历史顺序、Open-Meteo 与 timer 幂等测试 | Windows 自动化、真实 Core 读工具与角色动作写入通过；通知/QQ/邮件真实外发待环境验收 |
| 23 | `test_native_agent_adapter.py` | Python↔Rust bridge 被删除；Server 进程内直接调用 AgentCore | AgentCore loop/fs tests、App persistence tests、Sandbox operation tests、真实 Core 模型回合 | 有意替代，进程内集成验证通过 |
| 24 | `test_native_runtime_client.py` | stdio native client 被删除；模型回调和 turn completion 变成进程内 Rust API | AgentCore loop + App submitted input tests | 有意替代 |
| 25 | `test_openttd_connector.py` | Rust Admin Port client + Squirrel GameScript bridge，实例身份仍隔离 | framing/partial packet、协议协商、Admin action payload、GameScript ack、状态解码、PID+启动时钟+可执行文件+目标身份测试 | Linux 源码覆盖，待 Linux 复验 |
| 26 | `test_orchestrator_run_persistence.py` | 旧 orchestrator run 合并为 Director canonical events | App Director persistence、legacy director import test | 有意替代，源码覆盖待复验 |
| 27 | `test_permission_broker.py` | SQLite permission requests、持久模式、operation journal 和 crash recovery | Sandbox 4 项测试、Store permission/unknown recovery tests | 源码覆盖，待复验 |
| 28 | `test_permission_routes.py` | REST route 被 typed WebSocket RPC 替代，写入后才响应 | Sandbox/store 持久化测试、Server `permission.mode.get/set` 持久化与非法值测试 | 源码覆盖，待复验 |
| 29 | `test_prompt_cache.py` | AgentCore fingerprint/epoch/cache reason，Provider 透传 session cache key | AgentCore cache test、Provider cache payload tests | 源码覆盖，待复验 |
| 30 | `test_question_broker.py` | SQLite question request/answer/reject/expire，按会话释放 | Interaction wait test、Store reject test | 源码覆盖，待复验 |
| 31 | `test_routes.py` | 旧 REST/SSE 全部替换为 typed WS JSON-RPC、Blob 和 health endpoints | Server auth/session tests、Store lifecycle tests、Rust v2 generated client、真实 WebSocket RPC 验收 | 有意替代，协议与运行时验证通过 |
| 32 | `test_runtime_host.py` | Python event-loop host 被单一 Tokio runtime 和 supervised workers 替代 | App durable input test、worker heartbeat/readiness、强制停止与直接重启验收 | 有意替代，重启验证通过 |
| 33 | `test_runtime_persistence.py` | SQLite event log、CoreSync outbox、Provider retry/reset、speaker 元数据 | App/Store/CoreSync/Provider tests、前端 stream/director tests | 源码覆盖，待复验 |
| 34 | `test_runtime_vision.py` | 会话/角色 vision binding，文本模型视觉回退，多模态直传 | Provider vision tests、App prompt profile tests | 源码覆盖，待复验 |
| 35 | `test_screen_capture.py` | Rust MediaService + Electron capture + Provider 视觉路径 | MediaService source/schema、非图像 Blob 不消费请求、拒绝终态、Electron capture 与 Provider vision tests | 源码覆盖，待复验 |
| 36 | `test_self_awake.py` | `self-awake.v1` durable state machine、通知策略、日记、next wake、watchdog 和严格工具白名单 | App self-awake/profile tests、Store atomic completion、CoreSync notification、动态默认/会话 Core 凭据、legacy import test | Windows 自动化与真实 Core 凭据注入验证通过；真实外发通知待验收 |
| 37 | `test_service_auth.py` | 跨服务 HMAC/nonce 路由退出；本地 RPC 使用短期 capability token + Origin，Core 使用内存 credential ref | Server token/origin/subprotocol tests、CoreSync credential test | 有意替代 |
| 38 | `test_session_title.py` | Rust 后台标题生成、清洗、所有权和重启恢复 | App title tests、Store title lifecycle test、前端 session tests | 源码覆盖，待复验 |
| 39 | `test_skill_installer.py` | Rust 完整包 preview/install/update/uninstall、user/project 作用域、文件增删、同级备份、原子替换和内容哈希 | `mon-agent-skills` 11 项测试 | Windows 自动化验证通过 |
| 40 | `test_skills.py` | Rust skill catalog/profile/snapshot/watcher/tool dependency；代码工具经 manifest、自测、OS 沙箱、权限和运行 profile 隔离 | Skills 11 项、App profile/snapshot、Host inventory | Windows 自动化验证通过 |
| 41 | `test_speech_route.py` | TTS/STT 属于已登录 Mon Core/前端媒体边界，不再经 Agent Server 转发 | 前端 speech/realtime/tts tests | 退出边界 |
| 42 | `test_sticker_tools.py` | Rust Core tools 管理角色贴纸并发出 canonical UI event，子智能体机械拒绝 | Blob attachment 读取、语义/别名记录、204 空响应、durable sticker event、前端投影、MultiAgent policy；真实 Core 创建/发送/删除集成测试带失败清理 | Windows 自动化与真实 Core 完整往返验证通过 |
| 43 | `test_store.py` | SQLite sessions/events/messages/cursors/titles/character state/legacy import | Store 19 项测试、legacy import 2 项测试、前端 message/session tests | 源码覆盖，待复验 |
| 44 | `test_subagent_config.py` | TOML catalog、项目覆盖、预算、模型/技能和不可扩权策略 | MultiAgent catalog 2 项、runtime policy tests | 源码覆盖，待复验 |
| 45 | `test_subagent_repository.py` | SQLite agent tree、checkpoint、mailbox、batch 和恢复 | Store mailbox tests、MultiAgent persistence/restart tests | 源码覆盖，待复验 |
| 46 | `test_subagent_runtime.py` | Rust runtime 强制深度/并发/时间/turn/tool/token/费用预算和重启续跑 | MultiAgent 8 项测试、AgentCore nested-agent tests、前端 subagent test | 源码覆盖，待复验 |
| 47 | `test_web_tools.py` | Rust structured multi-provider web、缓存、引用、取消、总超时和 SSRF 防护 | `mon-agent-host/web.rs` 10 项测试 | 源码覆盖，待复验 |
| 48 | `test_workspace_switch_tool.py` | root-only、持久化 pending、空闲后提交和外部根目录授权 | Workspace 3 项、Store/Main workspace tests | 源码覆盖，待复验 |
| 49 | `test_start_openttd.py` | Node/Bash 启动器管理临时配置、端口、共享内容、桥接安装和子进程生命周期 | helper 单元测试；GameScript/AI 幂等安装且不删除用户文件；Linux 假进程覆盖默认/显式 join、dedicated 保存退出、注册表/配置清理、共享目录和旧内容单次迁移 | 桥接安装已在 Windows 验证；Linux 生命周期待 Linux 复验 |

## 当前未闭合的关键验收簇

当前未闭合项为：

1. 在 Linux 执行 OpenTTD 真实进程生命周期测试，并与实际 OpenTTD/Admin Port/GameScript 联调；当前机器没有 WSL 发行版、Docker 或 OpenTTD。
2. 在用户允许产生真实外发副作用且已配置目标的环境中，验收通知、QQ、邮件写入契约；Core 登录、模型目录、上下文、真实模型回合、角色动作切换、贴纸创建/发送/删除，以及邮件/QQ/日记只读端点已经通过。当前 QQ Bot 为 0，邮件 SMTP 未启用且未配置密码。
3. 用户明确要求后执行最终完整/release 构建；日常继续只做增量编译。

2026-08-20 已连续三轮复核以上条件：本机 WSL 发行版和 OpenTTD 均为 0；Core 邮件未启用、未就绪且没有密码；QQ Bot 总数和在线数均为 0。没有可合法执行的真实目标，也没有安装外部运行环境或执行 release 构建的授权，因此本矩阵进入等待状态。环境配置完成或用户给出相应授权后，从对应验收手册步骤继续，不重做已经通过的迁移与回归。

Rust Server 的强制终止恢复、数据库/operation journal 审计和直接重启已经闭合；桌面壳与 Web 的行为由 122 项 Desktop、142 项 Web 测试及开发启动冒烟覆盖。

## 最终验收记录格式

每个“待复验”项目只有在执行过覆盖对应路径的命令并记录结果后，才可改为“已验证”。最终记录至少包含：命令、时间、通过数量、失败项、运行平台、Core/模型/连接器前置条件，以及重启前后的数据库与副作用审计结果。
