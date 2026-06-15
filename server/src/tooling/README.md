# MonAgent Tooling

MonAgent 的工具分为三类：

- `builtin`：项目内置工具，例如 `ask_user`、文件读写、Shell、网页搜索。
- `extension`：后续从 npm 包或本地目录加载的 Pi 工具扩展。
- `mcp`：后续通过 MCP 服务桥接进来的工具。

`createMonAgentTools` 是唯一入口。新工具应先进入对应分类，再注册到 `ToolRegistry`，避免继续把所有逻辑堆进 `src/tools.ts`。

## Skill 与 Profile

工具管理分三层：

- `Tool`：单个可调用能力，例如 `create_memo`、`read`、`web_search`。
- `Skill`：一组相关工具，例如 `memo`、`workspace`、`web`、`self_awake`。
- `Profile`：本轮事件启用哪些 Skill，例如 `user_chat`、`self_awake`、`scheduled_task`。

新增工具时先在 `skills.ts` 里声明归属；如果某个事件来源需要这组能力，再在 `profiles.ts` 里启用对应 Skill。运行时仍可以在 `beforeToolCall` 做最终拦截，但模型默认只能看到当前 Profile 允许的工具。

## Builtin 文件分布

- `builtin/meta.ts`：工具清单与元信息。
- `builtin/web.ts`：网页搜索与网页抓取。
- `builtin/image.ts`：图片附件、图片路径和当前屏幕分析。
- `builtin/interaction.ts`：用户确认与问题卡片。
- `builtin/self-awake-tools.ts`：自醒定时器。
- `builtin/memo.ts`：备忘录、提醒、待办。
- `builtin/workspace.ts`：文件读写、搜索和 Shell。
- `builtin/shared.ts`：内置工具共享 helper。
- `builtin/mon-tools.ts`：只负责聚合各 builtin skill。
