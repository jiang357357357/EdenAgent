# 项目定位

这是 MonAgent 的 Pi 运行时版本，目标是为 Mon 项目提供可嵌入的本地智能体服务。

## 当前结构

- `Server`：Python 本地智能体宿主服务，通过 stdio 协议调用 `AgentCore` 的原生 sidecar。
- `AgentCore`：Rust 智能体核心、协议、运行时与本地工具工作区。
- `frontend/web`：MonAgent Web 前端，继续使用兼容旧接口形状的本地 API 封装。
- `frontend/desktop`：Electron 桌面壳，用于承载 Web 前端。
- `Script/Project`：项目内部开发启动脚本与 `.monconfig` 读取工具；Server 启动/检查脚本使用 Python。
- `Script/Cmd`：面向命令行或服务启动器的前台入口，拆分 Server/Desktop/All；Desktop 会先启动 Web 再打开桌面壳。

## 默认运行链路

1. `Script/Cmd/Linux/StartServer.sh` 或 `npm run dev:server` 启动 Python 宿主，默认监听 `0.0.0.0:40092`。
2. Server 启动并管理 `mon-agent-runtime` sidecar；可用 `MON_AGENT_RUNTIME_PATH` 覆盖二进制路径。
3. `Script/Cmd/Linux/StartDesktop.sh` 启动客户端：先启动 Web 前端，再打开桌面壳。
4. `Script/Cmd/Linux/StartAll.sh` 或 `npm run dev` 仅用于开发期一键启动 Server/Web/Desktop。
5. 模型由 `MON_AGENT_MODEL` 指定，格式为 `provider/model`，默认 `openai/gpt-4o-mini`。

## 改造方向

1. Rust AgentCore 负责 Agent/事件循环、工具执行、上下文压缩、技能解析和多智能体控制。
2. Server 保留模型提供商、权限、持久化、HTTP、连接器和 Mon 业务工具等宿主职责。
3. 对外保留前端需要的会话、消息、事件和权限接口形状，逐步收敛命名。
4. 写文件和执行命令必须走权限请求；只读工具可以直接运行。

## 技术栈

- Python 3.12+ / uv / 标准库 HTTP 服务
- Rust 1.85+ / Cargo / Tokio
- Node.js 22+ / npm / TypeScript
- React / Vite / Electron
