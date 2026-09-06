# Eden Agent Rust 运行与故障恢复手册

状态：源码基线；涉及构建和运行的命令必须在对应变更获得验证授权后执行。  
适用架构：Electron + React + 单进程 `eden-agent-server` + 进程内 AgentCore crates。

## 1. 运行前提

- Rust 1.85+、Cargo。
- Node.js 22+、npm 10。
- 默认 Agent Server：`127.0.0.1:40092`；默认 Web 开发服务：`127.0.0.1:40091`。
- 模型由 `EDEN_AGENT_MODEL=provider/model` 及对应 provider 的 Base URL/API Key 配置。
- Mon 业务能力需要 `MON_CORE_BASE_URL` 与仅保存在进程内存中的 `MON_CORE_TOKEN`。
- 终端默认使用经过启动探测的 OS 沙箱；缺少沙箱时拒绝执行，并显示原因。用户可在权限菜单明确开启本机执行，审批策略独立生效；MCP stdio 与技能代码仍要求沙箱。详见[终端执行边界](../../Server/docs/command-execution.md)。

主要持久路径可由环境变量覆盖：

| 数据 | 默认值 | 环境变量 |
|---|---|---|
| SQLite | `Data/eden-agent.db` | `EDEN_AGENT_DATABASE` |
| Blob | `Data/blobs` | `EDEN_AGENT_BLOB_ROOT` |
| Server 日志 | `Data/logs` | `EDEN_AGENT_LOG_DIRECTORY` |
| capability token 文件 | `Data/server-capability.token` | `EDEN_AGENT_TOKEN_FILE` |
| workspace | 当前目录 | `EDEN_AGENT_WORKSPACE_ROOT` |

## 2. 开发启动链

仓库根目录的标准入口：

```powershell
npm run dev:server   # 只启动 Rust Server
npm run dev:web      # 只启动 Vite Web
npm run dev:desktop  # Web + Electron，Electron 监管 Rust Server
npm run dev          # 完整开发链
```

Windows/Linux 的稳定入口分别位于 `Script/Cmd/Win` 与 `Script/Cmd/Linux`。不存在 Python host、Python `PYTHONPATH`、uv、stdio sidecar 或 Server/Core 私有进程协议。

开发修改默认使用 Cargo/npm 的增量产物。只有发布验收才清理缓存或执行完整 release 构建，不把“全量重编译”当作日常检查步骤。

## 3. 协议变更顺序

`Server/crates/eden-agent-api` 是协议唯一事实来源。任何 API 类型、方法或协议版本变化必须按以下顺序处理：

1. 修改 Rust API 类型与 Server handler。
2. 执行 `npm run generate:rpc`，更新 `frontend/web/src/generated/eden-agent-rpc.ts`。
3. 审查生成文件只包含预期协议差异，禁止手工维护第二份 RPC 类型。
4. 执行 Rust 定点测试、Web typecheck 与协议/历史恢复测试。
5. 前后端协议版本不同必须拒绝初始化，不能静默兼容。

当前迁移分支的 Rust 源是协议 v2；检入客户端仍需在获准构建后重新生成，详见完整迁移计划。

## 4. 健康与诊断

- `/healthz`：进程存活检查。
- `/readyz`：数据库、模型配置、工具宿主和后台 worker 就绪检查。返回非 2xx 时不得把实例加入可用链路。
- `/metrics`：Prometheus 文本，包含会话/输入/作业/连接器/CoreSync 队列，turn/tool/provider 计数，首 token/turn/tool/数据库延迟和 worker heartbeat age。
- 持久日志同时包含 session、turn、operation、job、connector correlation ID；写文件前统一凭据脱敏并按大小有限轮转。

诊断顺序：

1. 确认 `/healthz`，区分“进程未启动”和“进程已启动但未就绪”。
2. 查看 `/readyz` 的分项失败，不用 `/healthz` 代替依赖检查。
3. 查看 `/metrics` 的队列积压和 heartbeat age。
4. 使用 correlation ID 串联日志、SQLite 事件与 operation journal。
5. 不把 token、Core credential、邮件正文、QQ 正文或连接器凭据复制到诊断记录。

## 5. 异常终止后的恢复语义

Server 启动时执行确定性恢复：

- `claimed` 会话输入回到 `queued`，由每会话 actor 重新领取。
- `running` 子智能体回到可恢复队列，并保留父子路径、预算、checkpoint 与 mailbox。
- `generating` 会话标题回到 `pending`。
- durable job、CoreSync outbox 和 connector event 使用租约/幂等键继续处理。
- connector supervisor 根据持久 desired state 和 manifest revision 重建 worker；generation ID 防止旧 worker 退出时删除新 worker。
- operation journal 中已 `committed` 的副作用直接复用结果；遗留 `started` 一律转为 `unknown`，绝不自动重放。

`unknown` operation 必须经 typed RPC `operation.list` 查看，并由用户明确选择 `retry` 或 `abandon`。禁止直接修改 SQLite 绕过审计；`retry` 也只表示允许创建新的显式尝试，不代表系统已经证明旧操作未发生。

## 6. 数据与删除边界

- 事件先持久化再广播；历史事件支持按 cursor 分页读取。Web 收到 `event_stream_lagged` 告警或发现已观察会话的事件序号缺口时关闭旧连接并重连，重新读取会话列表、当前会话消息和待处理交互；其他已缓存会话在下次选择时刷新。重复或旧序号事件不会再次应用。
- 重连恢复使用服务端状态快照，不重放历史通知，避免再次触发已处理的语音或媒体动作。恢复失败会显示连接错误，应检查 Server 和数据库状态。
- 删除会话在存在运行输入/子智能体时拒绝；成功删除会级联本地状态，并通过 durable CoreSync 投影补偿远端状态。
- Blob 读取必须通过记录的 MIME、大小和完整性校验；贴纸的 `attachment://` 引用只解析当前消息附件。
- 旧 Mon Core SQLite 导入使用 ledger 幂等记录。连接器凭据、待执行任务、旧技能和 takeover 权限只导入为审计信息，不自动激活。

备份时至少一致复制 SQLite（含 WAL/SHM，或使用 SQLite 在线备份）、Blob 目录和必要日志。不得只复制主 `.db` 文件后宣称备份完整。

## 7. OpenTTD Linux 运行边界

`Script/Cmd/Linux/StartOpenTTD.sh` 管理 OpenTTD 主机/专用服。Admin Port 强制绑定 `127.0.0.1` 或 `localhost`；管理密码通过标准输入写入私有配置，不进入进程参数。

受管实例注册表固化 instance ID、PID、`/proc` 启动时钟、实际可执行文件、启动目标、端口和实例配置。join、replace 与清理只有在身份全部匹配时才停止进程，防止 PID 重用误杀。内容、下载和存档位于 XDG OpenTTD 持久目录；每次启动只创建唯一临时配置，退出后按身份删除。

Linux 发布机必须执行：

```bash
npm run test:openttd-launcher
```

随后再与实际 OpenTTD Admin Port、Eden AgentBridge GameScript 和存档进行联调。Windows 静态检查不能替代此项。

## 8. 分层验证顺序

获得构建授权后按失败半径从小到大执行：

```powershell
npm run generate:rpc
cargo test -p eden-agent-core
cargo test -p eden-agent-connectors
cargo test -p eden-agent-host
cargo test -p eden-agent-interaction
cargo test -p eden-agent-app
cargo test -p eden-agent-store
cargo test -p eden-agent-server
npm --prefix frontend/web test
npm --prefix frontend/web run typecheck
npm --prefix frontend/desktop test
```

修复所有增量失败后，再做真实 Core 联调、异常终止注入、Server 重启、Desktop 全链启动和最终完整构建。每项结果写回《Eden Agent 归档行为验收矩阵》，记录命令、时间、平台、通过数量、失败项和前置条件。

## 9. 发布阻断条件

以下任一项成立时不得宣称迁移完成或发布可用：

- Rust/前端协议版本或生成文件不一致。
- `/readyz` 仍有必需组件失败。
- 任一归档矩阵项只有源码、没有对应平台运行证据。
- `unknown` operation 未审计，或异常终止测试出现副作用重复。
- 真实 Core 的身份、通知、QQ、邮件、角色动作或贴纸契约未通过。
- Linux OpenTTD 生命周期/身份测试未通过。
- 项目重启后无法恢复会话、输入、后台任务、子智能体或前端历史。

## 10. 存储并发与事件恢复探测

生产文件数据库使用 WAL 和 8 个连接；SQLite 写事务仍串行提交。内存测试库使用单连接。可显式运行以下探测，测试只创建临时数据库：

```bash
cargo test -p eden-agent-store --test event_recovery_load --locked -- --ignored --nocapture
```

探测以 8 路并发流向 8 个会话写入 4096 个事件，每个事件含 256 字符增量。它故意让订阅者落后以触发广播丢帧，验证保留的通知已落库、重新打开数据库后事件完整且序号连续、按序号补拉正确，以及另一世界无法重新绑定该数据库。

输出包含写入吞吐、写入耗时 p50/p95/p99 和重新打开后读取事件的耗时。此测试默认忽略，不以固定耗时作为 CI 门槛。它衡量存储层，不覆盖真实模型、多智能体端到端延迟、进程强杀或断电恢复。

2026-09-06 本地 Linux 调试构建的一次结果：4096 个事件写入耗时约 5.54 秒（740 事件/秒），写入 p50/p95/p99 约为 1.23/4.01/5.47 毫秒，重新打开并读取约 49 毫秒。该结果仅作为本机基线，不能作为部署环境容量承诺。
