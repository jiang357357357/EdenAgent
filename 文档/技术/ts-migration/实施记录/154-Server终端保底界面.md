# Server 终端保底界面

日期：2026-09-27。范围：`Server/tui/`、Server 自身脚本及运行时打包。

用户要求在智能体后端文件夹创建独立 TUI，作为前端不可用时的保底通道，不影响当前 Web/Electron 前端。因此终端入口是单独的 Node 进程，只通过既有 `/rpc` WebSocket 使用 Server 的能力令牌、Mon Core 账号鉴权、持久会话和事件。它不启动第二份 Agent 运行时，不打开数据库，不更改前端源码或现有 RPC 协议。

TUI 支持应用聊天会话列表、历史、切换和创建，文字输入、引导/跟进与停止回合，待处理审批和提问。Mon Core 登录已移入首页，密码输入遮蔽显示且不加入输入历史；只保存 Core 令牌和账号标识到 OS 用户私有状态目录，不保存密码。启动时验证已保存的令牌，失效后在首页重新登录；外部提供的令牌优先使用且不复制到 TUI 状态文件。首页显示当前账号，`/account`、`/login`、`/logout` 和 `/retry` 处理账号及连接状态。会话事件先从 `message.list` 恢复最近历史，再用 `event.list` 补齐，随后处理实时 `session.event`，按会话序号去重。流式更新写入同一条回复；工具调用由当前后端的 `operation.started/completed` 事件显示。RPC 超时不自动重发输入，退出 TUI 不取消 Server 中正在执行的回合。终端输出剔除控制字符并限制单次显示长度。

按用户要求参考 OpenCode 的终端交互，已改为全屏工作台：消息区、宽终端会话侧栏、固定多行输入区、状态栏、命令面板以及审批和提问面板。快捷键支持会话切换、新建、停止、滚动和退出；括号粘贴先合并到输入区，再由用户确认发送。窄终端隐藏侧栏，极小终端提示放大。TUI 只复用现有 RPC，没有导入 OpenCode 代码或更改 Web/Electron 前端。

继续参照 `文档/参考/opencode/packages/tui` 的终端页面：增加可模糊搜索的命令与会话菜单、会话信息侧栏、首页首次输入建会话、消息时间线、会话重命名与状态查看、模型标签、工具详情和时间戳开关。消息区将用户消息、助手 Markdown 标题/引用/代码块、工具状态及系统提示分层呈现；浏览历史时新流式内容保持原滚动位置。切换会话时分别保留未发送草稿和输入历史。权限面板可查看完整请求，“总是允许”在界面中二次确认。配色参考其默认深色主题，保留 Eden 标识和现有 RPC 数据模型。

根据用户给出的 OpenCode 首页截图，再将默认启动页调整为大字标题、居中输入框、智能体/模型信息、快捷键提示和底部路径。源码在 `tui/home-frame.ts`；有终端背景图时依赖终端自身的透明背景设置，TUI 不读取或绘制用户图片。此前自动打开最近会话的行为改为默认停留首页，`--session` 仍直接打开会话；`/home` 返回首页。小终端保留简化布局。

用户实际打开新会话时出现 `No model configured for this session`。原因是 TUI 原先只调用 `model.read` 显示状态，没有像 Web 客户端那样调用 `model.catalog` 将 Core 已选模型绑定到新会话。现已在进入会话及发送前同步目录，缺模型时阻止 `turn.start` 并保留草稿；`/models` 提供 Core 已启用模型列表与修改 Core 模型设置的确认面板。多角色会话仍需在 Web 客户端分别绑定角色和导演模型；尘世模型由本地 Server 配置。

用户反馈会话页内容过密后，按 OpenCode 参考中的 `routes/home.tsx` 和 `routes/session/index.tsx` 调整信息层级：首页保留大字标识、居中输入、模型/智能体与账号页脚，命令面板直接覆盖在首页；Ctrl+N 返回首页，第一条消息才创建会话。会话页默认隐藏侧栏，消息区限制最大宽度并居中，输入框和模型/快捷键靠近，空闲时不显示重复状态；Ctrl+B 可展开精简侧栏。此改动仅在 `Server/tui/`，没有改 Web/Electron 前端或 RPC。

用户进一步给出 OpenCode 首页截图并指出视觉仍不一致，已将首页输入区增高到五行编辑区加模型/账号信息行，在宽终端保留上下留白；底部添加快捷操作提示、Tip 和版本号，字标继续使用 Eden 自有字形与左右明暗配色。当前运行中的 `eden` 是独立 Node 进程，不会热加载页面代码；需退出该进程并重新执行 `eden` 才能看到新页面。仅完成类型检查、构建和静态差异检查，未运行真实 UI 验收。

用户单独指出截图中的大字 Logo 后，将原四字简化块字替换为五行、全宽的 `EDEN AGENT` 字标；前半使用灰色、后半使用亮色，内部留空可透出终端背景。首页保持 Eden 品牌，不显示 OpenCode 商标。

继续核对 OpenCode 字模源码后，按用户要求重新设计 Eden 自己的首页字标：`Server/tui/eden-wordmark.ts` 用四行手工绘制的 `eden` 小写字形，由 `█`、`▀`、`▄` 拼出圆角和升部；前半采用 Web 默认 Eden 紫色，后半用浅色，底部半块笔画单独压暗。字标占 39 列，不依赖图片或放大终端字体；无彩色终端时仍保留完整字形。`home-frame.ts` 将其居中，并按实际四行高度计算与输入框的间距。此前五行 `EDEN AGENT` 已退出当前首页。Server 类型检查与独立 TUI 构建通过；按当前要求未运行 UI 或自动化测试，实际终端观感待打开 `eden` 验收。

用户随后截图显示的仍是旧版 `EDEN / 新会话` 顶栏与小号 `EDEN`。该画面来自 `terminal-frame.ts` 的小屏后备分支：首页原需至少 60 列、22 行，而正在运行的 VS Code TUI 终端实际为 101 列、20 行，因此新字标没有显示。当时先将首页入口放宽到至少 45 列、12 行；`home-frame.ts` 根据高度把编辑区压缩为一、三或五行，并调整字标与输入区间距，避免小终端中提示与页脚重叠。Server 类型检查与独立 TUI 构建通过；未运行 UI 或自动化测试。

用户实际看到四行手绘 `eden` 后指出字形不佳，要求调查 OpenCode 和 dsh 的大字来源。OpenCode 的 TUI `packages/tui/src/logo.ts` 保存成品四行字模，渲染组件逐字符着色；同仓库的 UI Logo 是独立 SVG 网格设计，官方另有 `opencode.ai/font` 字体生成页面，TUI 运行时未调用 FIGlet。检查的 dsh 社区 TUI `gxinxing/deepseek-harness-tui` 则把六行 ANSI Shadow 字模常量直接放在 `src/ui.js`，按行施加蓝色渐变；它的 README 也明确称为 ANSI Shadow Logo。Eden 因此改用 `pyfiglet 1.0.4` 的 `ansi_shadow` 字体离线生成六行 `EDEN`，把结果作为静态字模写入 `tui/eden-wordmark.ts`，运行时只加 Eden 紫色至浅色渐变，无新增运行依赖。六行字标在现有 101×20 VS Code 终端内仍可与三行编辑区共存；首页最低高度随之调整为 14 行，低于此高度走原小屏布局。Server 类型检查与独立 TUI 构建通过；按当前项目要求未运行 TUI/UI 测试，实际观感待用户重新打开确认。

## 智能体回复逐片段着色

用户提醒 OpenCode 会对智能体回复中的字词分别着色。源码确认：`文档/参考/opencode/packages/tui/src/routes/session/index.tsx` 的 `TextPart` 使用 OpenTUI `<markdown>`，传入 `syntaxStyle={syntax()}` 与 `streaming={true}`；代码、推理和差异内容也分别使用带 `syntaxStyle` 的 `<code>` 或 `<diff>`。`文档/参考/opencode/packages/tui/src/theme/index.ts` 的 `getSyntaxRules()` 按 Markdown 标题、粗体、斜体、链接、行内代码和编程语言词元分配前景色及样式。大字 Logo 则是另一套字模绘制，与回复着色链路无关。

Eden 的 `Server/tui/markdown-inline.ts` 将回复中的粗体、斜体、删除线、链接和行内代码解析成样式片段；`markdown-lines.ts` 继续处理标题、引用、列表及围栏代码，并将语言标记交给 `code-highlight.ts`。后者按需使用 `highlight.js` 的选定语言语法，将关键字、字符串、数字、注释、函数等词元映射到 Eden 的终端调色板。`styled-text.ts` 按终端字符宽度换行并保留片段边界；`terminal-frame.ts` 逐片段输出 ANSI 样式，关闭终端颜色时退回纯文本。未闭合的流式 Markdown 标记保留原文，正在生成的代码围栏仍按代码显示。未知语言或超过 12,000 字符的代码块退回普通代码文本，语法着色缓存限制为 32 块。实现的是当前会话常见 Markdown 子集，复杂表格、嵌套块等仍需后续扩充。

本轮 Server 类型检查和独立 TUI 构建通过；按当前项目要求没有新增或运行自动化、冒烟或 UI 测试，也未打开真实终端会话验收着色观感。

## 斜杠命令提示

用户指出输入 `/` 时看不到对应命令。此前命令执行、Ctrl+P 命令面板及 Tab 补全已存在，但输入框本身没有候选提示。现在 `tui/slash-commands.ts` 汇总面向用户的斜杠命令；首页和会话页在输入 `/` 后于输入框旁显示候选，继续输入时按命令名及说明筛选，↑↓ 选择、Tab 补全、Enter 执行。`/use`、`/rename` 等需要参数的命令选中后留在输入框等待填写；Esc 只关闭提示并保留草稿。登录用户名、密码和提问回答输入不显示命令提示；`//` 仍用于发送以 `/` 开头的普通消息。Server README 和 `/help` 已补充操作说明。类型检查与独立 TUI 构建通过；按当前项目要求未运行自动化、冒烟或 UI 测试，实际终端键盘交互待验收。

`Server/tui/app.ts` 和 `Server/tui/terminal.ts` 目前分别承担单个客户端的 RPC 编排与终端输入/生命周期状态机，超过 300 行警告线但均未达到 500 行阻止线。Core 凭据存取与登录状态另置于 `core-login.ts`、`auth-flow.ts`；筛选、Markdown 投影和布局计算也在独立文件。后续增加新的业务面板时应按职责继续拆分。

启动命令是 `eden`，默认连接 Mon 世界；`eden --origin local` 连接本地世界。源码启动器位于 `Server/bin/eden`，打包启动器位于运行时 `bin/eden`。单独的 `build:tui` 产出 `dist/server/tui.mjs`，Server 运行时打包时包含该入口、启动器及哈希，不修改当前 Server 主入口或 Web/Electron 启动链路。详细使用方法见 `Server/README.md`。

Server 类型检查、独立 TUI 构建和静态差异检查通过。当前按业务实现阶段要求，不新增或运行自动化、冒烟或 UI 测试，也没有连接真实账号或发送真实聊天输入。保底界面的文字与审批范围已经实现；图片、附件、摄像头等桌面媒体留在现有客户端。断线可手动 `/retry`，但尚未实现自动重连或恢复未完成的终端输入。
