# 项目定位

这是 Eden Agent 的全 Rust 本地智能体服务，为 Mon 项目提供可嵌入、可持久化的 Agent 运行时。

## 当前结构

- `AgentCore`：宿主无关的 Rust library crates，负责领域类型、Agent 循环、上下文、工具执行和本地工作区工具。
- `Server`：Rust 宿主服务，直接链接 AgentCore，负责 JSON-RPC、SQLite、模型供应商、权限、Blob、技能、多智能体、作业、连接器和 Mon 业务工具。
- `frontend/web`：React/Vite 客户端，只使用生成的 WebSocket JSON-RPC 客户端和 Blob 端点访问 Agent Server。
- `frontend/desktop`：Electron 桌面壳，启动并监管 `eden-agent-server`，向渲染进程传递短期能力令牌。
- `Script/Project`：开发启动和 `.monconfig` 读取工具。
- `Script/Cmd`：Server、Desktop 和 All 的命令行入口。

## 默认运行链路

1. `Script/Cmd/Win/StartServer.ps1`、`Script/Cmd/Linux/StartServer.sh` 或 `npm run dev:server` 启动 Rust Server，默认监听 `127.0.0.1:40092`。
2. Server 在同一进程内调用 AgentCore library crates；不存在 Python 宿主、stdio sidecar 或原生桥接协议。
3. Desktop 开发入口先启动 Web，再由 Electron 启动/监管 Rust Server；`npm run dev` 可一键启动全部组件。
4. 模型由 `EDEN_AGENT_MODEL=provider/model` 及对应供应商环境变量指定。

## 边界与安全

1. AgentCore 不依赖 HTTP、SQLite、具体模型供应商、Electron 或 Mon Core。
2. Server 拥有进程边界和所有外部副作用；事件先持久化再广播。
3. 写文件、执行命令、外部通信和其他副作用必须经过权限请求。
4. 命令工具只有在可用的 OS 沙箱中才注册；缺少沙箱时故障关闭。
5. 前端协议以 `eden-agent-api` Rust 类型和生成客户端为唯一事实来源。

## 技术栈

- Rust 1.85+ / Cargo / Tokio / Axum / SQLx
- Node.js 22+ / npm / TypeScript
- React / Vite / Electron
