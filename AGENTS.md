# 项目定位

新 TS 实现必须遵循 `文档/技术/Eden Agent TypeScript 工程约束.md`。任务与证据持续维护在 `文档/技术/Eden Agent TS 迁移实施跟踪.md`。用户已授权按照实现方案推进 P0–P5，不为常规可逆实现步骤反复请求确认；真实发布、外发及超出既有授权的操作另行处理。

> 2026-09-09 迁移状态：原 `AgentCore/` 和 `Server/` 已归档到 `Archive/2026-09-09-rust-runtime/`，旧 Server 保留子模块身份。新 TS 宿主已实现基础对话、隔离插件、审批和工作区工具，完整业务迁移仍在推进。实现与未完成项以实施跟踪为准，不能把旧 Rust 文档中的全部能力视为已迁移。

这是 Eden Agent 的 TypeScript 本地智能体宿主，为 Mon 项目提供可嵌入、可持久化的 Agent 运行时。

## 当前执行优先级

用户最新要求：先完成全部计划功能实现，再集中逐步测试与修正，不再每一步运行测试。优先推进完整业务覆盖，记录待验收项，保留最终 P0–P5 完成标准和数据/权限边界。本次迁移本地 Git 提交已明确授权。

## 当前结构

- `Server/src`：Node 宿主；bootstrap 组装，transport 协议，modules 按业务拆分。
- `packages/runtime-pi`：唯一允许导入 pi 的运行时适配包；只依赖公开 SDK。
- `packages/api`、`store`、`permissions`、`plugin-sdk`、`plugin-host`、`execution`：协议、基础存储、权限策略、插件与隔离执行。
- `Archive/2026-09-09-rust-runtime`：旧 Rust Core/Server 和原启动/CI 参考；新代码不得运行时依赖归档。
- `frontend/web`：React/Vite 客户端，只使用生成的 WebSocket JSON-RPC 客户端和 Blob 端点访问 Agent Server。
- `frontend/desktop`：Electron 桌面壳，分别启动并监管伊甸园与尘世两个 `eden-agent-server`，向渲染进程传递当前世界服务实例的能力令牌。
- `Script/Project`：开发启动和 `.monconfig` 读取工具。
- `Script/Cmd`：Server、Desktop 和 All 的命令行入口。

## 默认运行链路

1. `npm run dev` 启动伊甸园 Server（`127.0.0.1:40092`）和尘世 Server（`127.0.0.1:40093`），随后启动 Web 与 Desktop。
2. 两个 Node Server 在自身进程内通过 runtime-pi 运行智能体；Electron 监管器已接入 Node 制品与 IPC 退出，生产安装包资源组装及实际界面验收仍待完成。
3. 新数据默认分别使用 `Data/realms/mon/v2` 与 `Data/realms/local/v2`，旧 Data 禁止原地迁移；测试只使用临时目录。
4. 伊甸园已实现单角色模型目录/选择、多角色独立模型绑定、基础会话队列执行、活动角色信号及逐角色压缩。已确认的模型绑定和会话 Core 连接保存在 Mon 私有数据库，可在重启后恢复；未确认的模型选择会阻止恢复旧绑定。凭据不进入公共事件，不能继承尘世凭据。完整重规划及 UI 验收仍待迁移；尘世暂由 `EDEN_AGENT_MODEL=provider/model` 及对应供应商环境变量指定。

## 边界与安全

1. 基础包不能依赖 Server；运行时适配不依赖 HTTP、SQLite、Electron 或 Mon Core。
2. 两个世界拥有独立进程边界和外部副作用状态；数据库永久绑定一个 `runtime_origin`，事件先持久化再广播。
3. 写文件、执行命令、外部通信和其他副作用必须经过权限请求。
4. 终端执行边界与审批策略独立。默认沙箱执行，缺少沙箱或启动探测失败时拒绝执行；用户可通过明确确认开启本机执行，按当前 OS 账户权限运行。模型不得自行切换边界，运行中的进程结束前不得切换。MCP stdio 和技能代码仍要求可用沙箱。本机命令不提供两个世界之间的 OS 访问隔离。
5. 新协议事实来源迁移到 `packages/api`；旧生成客户端和归档 RPC 清单是兼容性基线，TS 生成流程尚待补齐。

## 技术栈

- Node.js 22.23.1 / npm / TypeScript / SQLite
- pi 0.82.0 公共 AgentHarness / Session / provider API
- React / Vite / Electron
