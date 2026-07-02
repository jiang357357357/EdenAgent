# 项目定位

这是 MonAgent 的 Pi 运行时版本，目标是为 Mon 项目提供可嵌入的本地智能体服务。

## 当前结构

- `Server`：Python 本地智能体服务，通过兄弟子仓库 `AgentCore` 调用 Python AgentCore。
- `AgentCore`：从 Pi Agent Core 迁移来的 Python 核心封装。
- `frontend/web`：MonAgent Web 前端，继续使用兼容旧接口形状的本地 API 封装。
- `frontend/desktop`：Electron 桌面壳，用于承载 Web 前端。
- `Script/Project`：项目内部开发启动脚本与 `.monconfig` 读取工具；Server 启动/检查脚本使用 Python。
- `Script/Cmd`：面向命令行或服务启动器的前台入口，已拆分 Server/Web/Desktop/All。

## 默认运行链路

1. `Script/Cmd/Linux/StartServer.sh` 或 `npm run dev:server` 启动 Python 后端，默认监听 `0.0.0.0:40092`。
2. `Script/Cmd/Linux/StartWeb.sh` 或 `npm run dev:web` 启动 Web 前端，默认监听 `40091`。
3. `Script/Cmd/Linux/StartDesktop.sh` 启动桌面壳，要求 Web 已经就绪。
4. `Script/Cmd/Linux/StartAll.sh` 或 `npm run dev` 仅用于开发期一键启动 Server/Web/Desktop。
5. 模型由 `MON_AGENT_MODEL` 指定，格式为 `provider/model`，默认 `openai/gpt-4o-mini`。

## 改造方向

1. 以 Pi 的 `Agent`/事件循环作为核心，不再维护旧版 agent server/core/sdk/plugin/script 包。
2. 对外保留前端需要的会话、消息、事件、权限接口形状，逐步收敛命名。
3. 工具系统保留本地 `read`、`ls`、`grep`、`find`、`write`、`edit`、`bash`，并提供 Web、图片、交互、备忘录和自醒工具。
4. 写文件和执行命令必须走权限请求；只读工具可以直接运行。

## 技术栈

- Python 3.12+ / uv / 标准库 HTTP 服务
- `mon_agent_core`（来自 `AgentCore` 子仓库）
- Node.js 22+ / npm / TypeScript（用于 Web 前端和桌面壳）
- React / Vite
- Electron
