# Eden 扩展平台 API 2

2026-11-06 用户批准参照 VS Code 扩展机制建设 Eden 原生扩展平台。本协议面向当前源码，不代表客户包已经升级，也不提供 vscode API 或 VSIX 兼容。

## 架构与兼容

统一插件包继续通过现有检查、冻结快照、安装、组件开关、版本授权及卸载流程管理。`ui.json` 保留 `type: module`，使用独立的 `apiVersion: 2`。旧 `apiVersion: 1` 保留 React、effect、样式、会话及工具桥接口，但改为每个视图独立的来源隔离页面，不再在工作台执行插件源码或共享 React 实例、全局 CSS 和模块变量；不应依赖父页面 DOM 或跨视图模块单例。Mon 产品版本不随 API 编号推进。

API 2 分为三部分：主工作台按声明渲染命令、菜单、快捷键、状态栏和原生树；每个扩展组件的业务逻辑按需在独立 Worker 运行；自定义 HTML 页面在不共享父页面来源的 iframe 中运行，通过专用 MessagePort 通信。浏览器页面边界和执行线程调整不恢复项目已暂停的操作系统沙箱，也不声称能限制任意 Worker 的系统外部网络。

应用导航与工作台文档属于不同层级。自醒、所有会话、备忘、设置、配置、技能、插件管理、连接器及共享资料库等内置页面独占窗口，不注册为编辑标签，不允许移到分屏或运行面板；返回聊天时保留原工作台实例、草稿及布局。扩展可通过 `full_page` 使用受控的整窗展示层，但不能注册任意应用路由或访问宿主 DOM；`page` 仍表示可分屏工作视图。

Worker 不接收应用令牌、RPC 连接或其他会话能力；每次操作由宿主绑定具体应用会话、组件版本和取消信号。SDK 业务访问继续经过服务端会话归属、清单能力、参数及权限校验。一个扩展的同步死循环不阻塞工作台主渲染线程；超时或不响应取消时终止它的 Worker，不自动重放操作。

## 创建与安装

```powershell
node Script/Project/create_extension.mjs <新的源码目录> <插件id>
```

生成统一包 `plugin.json`、`ui.json`、`extension.js`、`view.html` 和说明文件；拒绝覆盖已有目录。示例包含活动入口、工具栏命令、快捷键、状态栏、设置、持久计数及原生树数据提供程序。

智能体先调用 `manage_ui_plugins({action:"describe"})`，其中 `extensions` 返回当前 API 2 协议。编写文件后通过同一管理入口执行 inspect、install；安装与启用继续按当前审批模式处理。修改源码不直接改变已安装快照。需要后台进程时，继续在统一包组合 MCP 或连接器。

模块 entry 必须是完整打包的 ESM JavaScript，最多 256 KiB。HTML 视图 entry 为包内 UTF-8 文件，最多 1 MiB，脚本和样式内联；页面默认禁止外部联网和嵌入其他页面。前端再次验证模块和 HTML 的 SHA-256，资源正文不进入轮询目录。

## 展示类型

API 2 在 `views[].slot` 中声明位置，`renderer` 决定该位置中的内容。安装检查、扩展菜单及 `context.openView(viewId)` 使用相同规则；打开扩展不再自动搬动聊天。

| slot | 行为 |
| --- | --- |
| `page` | 工作区标签，可分屏、拖动或由用户移入工具侧栏／面板 |
| `full_page` | 独占整个应用窗口；“返回工作台”只隐藏并保留实例，关闭执行未保存确认 |
| `sidebar_panel` | 固定右侧工具栏，不挤走或搬动聊天；窄窗口使用工作台紧凑布局 |
| `bottom_panel` | 打开工具面板，默认在底部，跟随用户的上下左右面板位置设置 |
| `floating_window` | 独立浮动窗口，绑定原来的会话；每个工作台最多 8 个 |
| `tool_card` | 随 `toolNames` 对应的工具结果渲染，不允许通过 `openView` 单独打开 |

`full_page`、`sidebar_panel`、`bottom_panel` 和 `floating_window` 不能拖入其他容器；工作区 `page` 保留手动布局能力。`webview` 和 `tree` 可以使用以上相应容器；文件关联 `renderer: editor` 仅使用 `slot: page` 并从匹配文件入口打开。

```json
{"id":"dashboard","title":"仪表盘","slot":"full_page","renderer":"webview","entry":"dashboard.html"}
```

浮动窗口使用同源的受控空白宿主承载视图；插件 HTML 仍为独立来源 iframe，Worker 和业务权限仍由原宿主持有。Electron 子窗口不注入桌面桥、能力令牌或 Node，禁止离开窗口宿主及继续创建子窗口；宿主通过专用端口连接页面。浏览器可能拦截弹窗，此时显示明确的重新打开入口，不降级成另一种展示类型。窗口离开获准文档或关闭后撤销连接，停用／卸载撤下独占页及浮动窗口。

用 `setState/getState` 保留视图草稿，用 `setDirty/registerSave` 接入保存与关闭确认；缓存按账号工作区的文档实例和资源修订隔离。它不是持久业务数据库，浏览器强制结束或整应用退出后的数据恢复由后端存储与作者的保存逻辑承担。浮动窗口的 OS 位置和尺寸本轮不持久化。新类型只属于 API 2；API 1 继续接受原有三种 slot。

## 声明工作台贡献

`contributes` 支持：

| 字段 | 结构与用途 |
| --- | --- |
| commands | `{id,title,when?}`，注册到命令面板，必须实现对应命令 |
| menus | `{command,location,view?,group?,order?,when?}`；位置为 toolbar、activity、view/title、view/item/context 或 editor/context |
| keybindings | `{command,key,when?}`；支持 Ctrl、Cmd、CtrlCmd、Shift、Alt 与按键组合；同一命令的多个绑定均生效。页面内转发仅限本扩展组件和绑定会话，不允许页面借快捷键调用其他扩展；有保存回调时 Ctrl/Cmd+S 优先保存 |
| statusBar | `{id,text,command?,alignment?,priority?,when?}`；文字可在调用中更新，版本切换不沿用旧文字 |
| configuration | `{key:{type,title,description?,default,enum?}}`；支持 string、number、boolean，默认值和枚举必须匹配类型 |

命令 ID 在扩展组件内唯一，菜单、快捷键和状态栏不能引用未声明的命令。工作台使用 `插件id/组件id/贡献id` 区分不同扩展。

`when` 是条件对象，支持 `sessionAvailable`、`sessionRunning` 和 `activeView`；所有已声明条件同时满足才显示或绑定。`activeView` 使用完整的插件视图键。普通字符快捷键不会抢占输入框；不同扩展的相同快捷键按当前目录顺序选择首个符合条件的命令。

## Worker SDK

公开类型入口 `@eden/plugin-sdk/extension`。模块导出 `activate(api)`，可异步完成并返回 `{dispose()}`。默认按命令／视图激活；声明 `onStartup` 可提前激活。激活必须在 10 秒内完成并注册所有声明的命令与树提供程序。

- `registerCommand(id,(context,...arguments)=>result)`。
- `registerTreeDataProvider(viewId,(context,parentId?)=>items)`，节点为 `{id,label,description?,hasChildren?,command?,arguments?}`。单次最多 500 节点，界面最多保留 5000 个已加载节点，递归深度最多 24；刷新取消旧请求并丢弃迟到结果。
- `registerWebviewMessageHandler(viewId,(context,message)=>result)`。
- `onDidChangeConfiguration(listener)` 接收当前客户端修改的设置键。
- `log(level,message)` 写入最多 100 条当前 Worker 诊断日志。

注册返回 `{dispose()}`。更新、停用、卸载及世界／账号切换撤销业务能力，给予同步清理一个受限的执行机会后终止 Worker；不响应时仍会被终止。手动重启只重新激活注册，不重放原业务操作。

每次调用的 context 提供 `signal`、绑定的 `sessionId`，以及：

- 会话概要、消息输入和已声明工具的 `readSession`、`sendMessage`、`callTool`。
- `storage(scope)` 与 `configuration(scope)`；读写通过后端 SQLite，不能用前端状态冒充保存成功。
- `showMessage`、`showProgress`、`openView`、`setStatusBarItem`、`refreshTree` 和 `postMessage`。命令调用的 postMessage 通知本组件、同一绑定会话的视图；由视图发起时只通知该实例。打开新视图保留本次调用的会话，树刷新也只通知同会话的相关视图。

context 只属于本次调用。处理器返回后，不能将它保留为后台能力。持久后台业务使用 MCP、连接器或已有任务机制。调用最多 120 秒；用户可以取消，未响应取消的 Worker 在宽限期后终止。取消不能回滚已经发生的外部副作用。

## 存储与设置

scope 为 `global`（当前账号）或 `workspace`（当前账号、当前所选目录）。数据按插件及组件隔离，卸载和重新安装不主动删除用户业务数据。

`get(key)` 返回 `{value,revision}`；`update(key,value,expectedRevision?)` 和 `remove(key,expectedRevision?)` 返回保存后的状态。需要避免覆盖时传原 revision，冲突后先读取，由业务决定如何处理，不自动重试写操作。删除保留 revision，避免旧写入重新生效。

单项最多 256 KiB，同一范围总计最多 1 MiB、512 个有效键；删除记录释放配额，修订号仍保留用于阻止旧写入。设置必须声明且类型有效，删除设置恢复默认值。新版本改变设置类型或枚举后，不兼容的旧值读取为新版默认值，同时保留旧原值和 revision，方便回滚或由作者显式迁移；不会自动转换任意业务数据。这是普通业务状态存储，不是凭据保管接口。工作台命令“打开扩展设置”可编辑当前账号或工作区设置。

同一账号的配置修订摘要随现有约两秒一次的目录同步传递，不包含配置值或工作区路径。另一客户端修改后，Worker 收到 `api.onDidChangeConfiguration(keys)`，页面收到 `api.onDidChangeConfiguration(keys)`，树和设置窗口刷新；页面可在回调中通过消息处理器重新读取设置，不重建页面或重放写操作。通知表示声明的设置可能变化，可能重复；后台窗口、网络断开或浏览器计时器节流可能延迟，重新同步后补通知。

激活中的单次调用取消立即结束该调用等待，不取消其他调用共享的激活过程。旧 API 1 的 React 运行库按需加载，页面激活最多等待十秒；Electron 启用 Chromium `site-per-process`，使来源隔离页面使用独立渲染进程。该设置不是恢复已暂停的 OS 执行沙箱。

## 独立页面与自定义编辑器

视图继续使用 page、sidebar_panel、tool_card 插槽；`renderer` 为 webview、tree 或 editor。复杂 HTML 视图通过 `await acquireEdenApi()` 获取页面接口，不能直接读取父工作台 DOM。

页面 SDK 提供 command/message 请求、已声明的会话和工具调用、getState/setState 页面草稿、setDirty/registerSave、onDidReceiveMessage。草稿仅随当前页面实例保留；重启恢复必须由后端存储实现。保存、关闭确认由原工作台文档生命周期统一处理；注册保存回调后支持页面内 Ctrl+S。页面离开获准文档时断开消息桥并取消在途请求，重新加载只使用原安装资源。

自定义编辑器声明 `filePatterns`（精确文件名或 `*.扩展名`）、HTML entry 与 `capabilities.documents:true`。用户从文件区域打开匹配文件时使用该编辑器；匹配多个时按当前目录顺序选择首个。文件路径由宿主绑定，页面不能借 document 方法改写另一文件。

`api.document.read()` 返回 `{content,revision}`，revision 是实际磁盘内容 SHA-256；`save(content,revision)` 通过原工作区变更队列与审批写入，原始内容变化时拒绝覆盖。只支持所选工作区中的完整 UTF-8 文件，最多 1 MiB。编辑器负责自己的输入、撤销重做与冲突处理；目前未提供类似 VS Code 的统一文本缓冲区、跨编辑器撤销栈和文件监听 Provider。

## 诊断与范围

工作台命令“查看扩展诊断”显示 inactive、activating、ready、failed，保留具体错误和日志，并提供手动重启。主界面向 `manage_ui_plugins.status` 回报 executionState；加载资源、Worker 就绪、视图挂载和业务成功分别验证。

本轮建立 Eden 原生扩展平台的工作台、执行、存储与编辑器接入基础。已有统一包继续提供版本选择、签名／完整性及兼容范围校验。尚未提供通用凭据 SDK、扩展依赖解析器、远程扩展宿主、统一文本编辑模型、LSP／DAP／SCM Provider 或 VSIX 兼容层；不能称为完整 VS Code 扩展生态等价实现。

真实验证入口：`Server/tests/integration/plugin-ui/extension-platform.test.ts`、`Script/Test/extension_platform_browser.mjs`；仅使用系统临时目录和合成数据，不更新客户运行目录。最终命令与结果记录在《Eden Agent TS 迁移实施跟踪》中。
