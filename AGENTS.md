# 项目定位

这是 MonAgent 的 Pi 运行时版本，目标是为 Mon 项目提供可嵌入的本地智能体服务。

## 当前结构

- `server`：基于 `@earendil-works/pi-agent-core` 的本地智能体服务。
- `frontend/web`：MonAgent Web 前端，继续使用兼容旧接口形状的本地 API 封装。
- `frontend/desktop`：Tauri 桌面壳，用于承载 Web 前端。
- `Script/Project`：项目内部开发启动脚本与 `.monconfig` 读取工具。
- `Script/cmd`：面向命令行或后续封装入口的脚本目录。

## 默认运行链路

1. `bun run dev:server` 启动 `server/src/server.ts`。
2. 服务端读取 `.monconfig`，默认监听 `127.0.0.1:40092`。
3. Web 前端开发代理走 `/api`，生产默认连接 `http://localhost:40092`。
4. 模型由 `MON_AGENT_MODEL` 指定，格式为 `provider/model`，默认 `openai/gpt-4o-mini`。

## 改造方向

1. 以 Pi 的 `Agent`/事件循环作为核心，不再维护旧 opencode server/core/sdk/plugin/script 包。
2. 对外保留前端需要的会话、消息、事件、权限接口形状，逐步收敛命名。
3. 工具系统先保留本地 `read`、`ls`、`grep`、`write`、`shell`，再按 Mon 需要扩展。
4. 写文件和执行命令必须走权限请求；只读工具可以直接运行。

## 技术栈

- Bun 1.3+ / TypeScript
- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-ai`
- React / Vite
- Tauri
