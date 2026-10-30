# 2026-10-23 Computer Use 独立实现与桌面驱动替换

> 2026-10-24：本独立后端已退役归档，不再作为运行或发行实现。当前直接内置官方 Cua Driver 0.28.0 及全部 56 个公开工具，见[内置接入记录](2026-10-24-Cua官方运行时内置与完整工具接入.md)。下文为历史实施及当时测试记录，不代表当前后端行为或真实 GUI 验收。

Eden 的 Windows 桌面执行链已由 `@trycua/cua-driver@0.28.0` 替换为项目自行编写的原生后端，采用窗口绑定、截图定位、前台输入和操作后观察的流程。当前实现通过自动化与独立发行资源验证；真实 QQ、前台键鼠、跨窗口拖放及硬件接管仍待人工验收。在线 Server 和共享桌面服务尚未切换。

> 同日复核发现当前独立实现存在 6 个已复现缺陷，涉及输入目标、焦点、坐标映射和恢复流程，尚未修复。下文 84 项通过仅是原有覆盖结果，当前版本不具备替换验收条件，详见[Cua 与 Eden 桌面实现对比审计](2026-10-23-Cua与Eden桌面实现对比审计.md)。

## 官方源码与本次实现的来源

OpenAI 公开了 MIT 许可的 [Computer Use 示例仓库](https://github.com/openai/openai-cua-sample-app)，其中包含 JavaScript／Playwright 和 Python／PyAutoGUI 实现。仓库明确说明 OpenAI 产品使用自己的运行时和额外控制机制。[官方 API 指南](https://developers.openai.com/api/docs/guides/tools-computer-use)同样要求接入方提供执行驱动并管理会话、权限和资源清理。

本机 Codex Computer Use 插件版本 `26.1007.71326` 的 `.codex-plugin/plugin.json` 标注 `license: Proprietary`，其引用的 `openai/openai/tree/master/project/cua/sky_js/plugin` 地址及对应公开 GitHub API／raw 地址返回 404。公开 npm registry 的 `@oai/sky` 包地址也返回 404。这些结果只证明所检查的公开入口无法取得源码或包，不能据此推断 OpenAI 没有任何 Computer Use 开源代码。

本次代码参考本机插件公开给智能体的接口文档与操作流程，由 Eden 独立实现；没有接入 `@oai/sky`，没有复制 Codex 私有辅助程序，也没有把官方示例的 PyAutoGUI／Playwright 执行链接入宿主。不得将本次替换描述为“接入 OpenAI 原版桌面引擎”。

## 行为变化

| 场景 | 当前行为 |
| --- | --- |
| 观察窗口 | 默认截图、按需读取无障碍树；需要控件、焦点或文字时指定 `include_text=true` |
| 截图坐标 | 模型使用窗口截图内像素和对应 `screenshotId`；宿主只转换一次到物理桌面像素 |
| 控件矩形 | 原生后端相对 UIA 窗口根矩形映射到截图坐标；不再把旧驱动矩形与系统物理边界直接求交 |
| 输入投递 | 默认前台，明确拒绝后台投递；保留审批、超时、取消、暂停与用户接管 |
| 观察有效性 | 每个窗口的新观察替换旧引用；一次输入消耗该观察，失败或未知结果也不自动重放 |
| 输入目标 | 输入文字前检查真实焦点属于目标窗口；指定控件时还须与焦点一致，密码控件拒绝读取和输入 |
| 切换业务目标 | 点击可提供 `expectedTitle`；后续标题不匹配返回 `unknown` 和 `target_mismatch`，当前观察不可直接用于继续输入 |
| 操作结果 | 原生送达与业务成功分开；`delivered` 不证明文字、消息或保存已经完成，操作后返回新观察供核对 |
| 文本读取 | `desktop_read_text` 获取无截图的新树；无图宽高为 0，比例为 `null`，不被解释为截图损坏 |
| 原生进程重启 | 推进宿主内部代际，废弃旧截图和控件；中断的输入归为未知，不自动重放 |

真实会话曾出现“预期点击晓晨星，结果标题变成游戏群”的目标偏离。新增回归明确验证此时返回目标不匹配，并阻止沿用该观察输入；它验证宿主的失败处理，不证明真实 QQ 的点击准确率已通过验收。`expectedTitle` 是调用方提供的标题关键词，未提供时仍需智能体核对实际目标。

## 模块与状态归属

| 模块 | 输入与输出 | 状态与失败处理 |
| --- | --- | --- |
| `computer-use-driver.ts` | 原生窗口、观察和动作的 schema 适配 | 拒绝不支持的投递方式；只返回送达事实 |
| `computer-use-transport.ts` | Eden 自有 stdio 协议 | 原生进程、请求取消和代际由共享驱动服务持有；启动 5 秒、请求 30 秒、取消宽限 7 秒，阻塞后结束子进程 |
| `native/computer-use/Windows.cs` | Win32 窗口、身份、DPI 与物理边界 | 检查窗口、进程启动身份和前台状态 |
| `Capture.cs`、`Accessibility.cs` | PNG、UIA 控件、焦点及私有快照 | 最新快照绑定窗口与进程；检查尺寸、控件矩形及内容指纹，旧引用拒绝执行 |
| `Input.cs`、`Host.cs` | 前台 SendInput、UIA ValuePattern、窗口及应用操作 | STA 串行队列、取消检查、鼠标和修饰键释放；部分输入或失联保留未知结果 |
| `window-targets.ts`、`desktop-executor.ts`、`action-confirmation.ts` | 业务窗口／控件／截图引用及操作后观察 | 引用按调用方和会话隔离，原生句柄、快照令牌、指纹和代际不进入模型结果 |
| `build_computer_use.mjs`、`desktop_resources.mjs` | .NET Framework 编译与发行复制 | 内容哈希命名 exe、manifest 和 SHA-256 一起组装；不再分发 Cua SDK |

双世界仍通过同一共享驱动服务串行使用物理输入，各自保留数据库、审批和操作记录。工具说明展示与执行注册分离的既有修复保持生效，说明是否加载不作为执行权限。

## 捕获与实机边界

当前捕获方式为 `foreground_screen_copy`，使用 `Graphics.CopyFromScreen`，要求目标窗口在前台、未最小化，且通过若干位置的遮挡检查。检查不能证明每个像素都未遮挡；置顶覆盖、透明窗口和画面瞬态仍需实机验证。当前实现没有 Codex 原版使用的 WGC 遮挡窗口捕获能力。无障碍树来自 UIA，不能等同浏览器 DOM 全文，也不保证所有 Chromium 编辑器可读。

跨窗口拖放要求先观察目标，再激活并观察源窗口，两个端点实际可见，当前限制在主屏幕。混合 DPI、多屏、RDP、UAC 安全桌面、管理员窗口、真实 QQ 的 UIA 尺度和焦点变化均未完成验收。不得把夹具中 2 倍矩形归一化通过写成所有窗口尺度已正确。

所有操作继续按当前 OS 账户本机运行，没有加入执行沙箱。桌面控制小窗仍只从托盘显式打开；工具调用和接管暂停不会自动弹窗。暂停后恢复依赖用户操作，智能体不能用观察或激活绕过暂停。

## 构建与版本切换

旧 `native-driver.ts`、`native-observation.ts`、`native-errors.ts`、`native-session.ts` 及 7 个旧 SDK 专属夹具／测试文件已移至 `Archive/2026-10-23-desktop-cua-replaced`。活动代码没有运行时归档依赖。`Server/package.json` 与根 lockfile 移除 `@trycua/cua-driver`，Server 构建和发行资源改为独立后端及既有输入观察器。

共享桌面协议从 `eden.desktop.1` 更新为 `eden.desktop.2`，沿用同一服务目录及管道，避免两套驱动同时抢占桌面。新客户端发现旧服务会返回 `BROKER_UPDATE_REQUIRED`，不会继续用旧驱动，也不会自动结束在线进程。

切换时应先结束当前桌面任务，在原监管器下停止共享桌面服务，再重新加载两个世界的 Server 和桌面客户端，使下一次调用启动新的驱动服务；不能只刷新聊天页面。需保留服务目录中的停止状态及令牌，不删除目录规避版本检查。当前工作没有自动重启在线进程、操作真实 QQ、提交推送或发布。

## 验证结果

使用固定 Node.js `22.23.1` 和系统 .NET Framework 编译器，数据库及服务状态只使用独立临时目录。

| 命令 | 结果 |
| --- | --- |
| `node Script/Test/run_typescript_tests.mjs Server/tests/unit/desktop Server/tests/integration/desktop Server/tests/integration/capabilities` | 83 项通过，0 失败，0 跳过 |
| `node --import tsx --test Script/Project/desktop_artifact.test.mjs` | 1 项通过：搬迁制品真实启动、资源摘要、认证／停止状态及无旧 SDK 依赖 |
| `node node_modules/typescript/bin/tsc -p tsconfig.server.json --noEmit` | 通过 |
| `node Script/Architecture/check.mjs` | 1284 个源码文件，0 错误；保留共享服务装配函数既有长度警告 |
| `node Script/Project/build_server.mjs` | Server、worker、共享桌面服务及两个 C# 辅助程序构建通过 |

共 84 项不同测试，重跑不重复计数。新增覆盖截图绑定、旧观察拒绝、坐标归一化、文字按需获取、真实焦点映射、目标不匹配、双端拖放快照、进程崩溃／取消后不重放、旧协议服务拒绝及原生窗口枚举。原生测试只枚举窗口，不截图、不激活、不发送键鼠输入；真实桌面效果仍按前述边界待验收。

证据位于 `.artifacts/computer-use-replacement-20261023/`：`tests-final.log`、`artifact.log`、`typecheck.log`、`architecture.log`、`build.log`、`artifact/report.json`、`verification.json`。初次回归的 3 项失败与两处复杂度门禁失败均已修正，最终结果以上表为准。
