# MonAgent Tooling

MonAgent 的工具分为三类：

- `builtin`：项目内置工具，例如 `ask_user`、文件读写、Shell、网页搜索。
- `extension`：后续从 npm 包或本地目录加载的 Pi 工具扩展。
- `mcp`：后续通过 MCP 服务桥接进来的工具。

`createMonAgentTools` 是唯一入口。新工具应先进入对应分类，再注册到 `ToolRegistry`，避免继续把所有逻辑堆进 `src/tools.ts`。
