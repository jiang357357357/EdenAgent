# VideoContext 内置与 256K 默认窗口

用户要求：移植 VideoContext 视频能力，并把窗口提高至 256K。

## 实现

采用 `sakshamjain2301/videocontext-mcp` 的固定提交 `b1495070863fc65372c986df52f992b9e5f40c02`，MIT 引擎源码放在 `Server/resources/video-context`，保留 LICENSE、原始 uv.lock、冻结依赖和来源说明。宿主业务由 `Server/src/modules/video` 的 TypeScript 实现；视频处理仍由独立 Python 进程执行，没有把 Python 引擎改写成 TS。

内置 `video-context` 技能和七个工具：检查视频、准备视频、读取时间线、读取帧图、读取预览、删除任务与依赖检查。原版分别针对 local／YouTube 的检查和准备工具，在 Eden 中通过 `source` 合并。工具参数放入 `packages/api/src/video.ts`，中文说明集中在 `Server/src/model-prompts`。登记当前与历史模型结果契约，帧图通过 `resultImages` 进入真实图片输入，转写和帧描述保留业务任务／帧 ID。

App 可以指定本轮附件或当前工作区视频；QQ 私聊把 OneBot 视频段归入文件输入，群聊沿用同群引用视频并显式 @机器人的准入流程。BotCore 只读取 NapCat 返回的已接收 MP4／WebM 本地缓存，未知尺寸允许有界读取，已知尺寸严格校验；复用请求、消息、发言人、引用来源、哈希和分块上传。没有根据消息中的任意 URL 下载资源。QQ 不能指定本机工作区视频路径。

任务状态归属当前世界／账号的数据根，再按会话与行动角色划分。跨回合可继续读自己的任务，不同会话和角色使用不同任务目录。当前附件读取仍受活动输入限制，工作区选择在审批后及复制后复核，暂存视频在调用结束后清理。向模型返回原文件名，临时 UUID 文件名留在处理器内部。

所有调用经过现有权限请求；群本地视频处理属于当前附件的派生处理，网络下载仍需群操作授权。每个后端最多两个并发工作进程，同一任务作用域禁止重叠启动，避免新进程启动清理时删除仍在处理的暂存内容。每次调用结束关闭进程树，取消和宿主关闭继续生效。单任务限时 110 秒，单任务最多 300 帧，单次取图最多 8 帧；图片二进制上限 5 MiB，保留 base64／JSON 空间以满足 8 MiB MCP 报文限制。输入不超过 512 MiB，输出不超过 256 MiB；App／QQ 附件仍分别遵循原 32 MiB／100 MB 限制。

保留前轮已验证的 Windows `SystemRoot`／`WINDIR` 子进程环境修补，使 Whisper 工作进程不再出现 WinError 10106。Eden 入口按当前 OS 账户权限运行，不创建 OS 沙箱，也不采用上游 CLI 的 root 拒绝策略。

## 窗口

本地模型默认窗口从 32768 改为 **262144 tokens（256K）**；Mon 缺少显式窗口时的回退值从 128000 改为相同值。修正 `contextSize`：MCP 图片文本占位符不再作为第二张真实图片计入 8192-token 图片预算。真实图片仍保留保守估算。

`EDEN_AGENT_CONTEXT_WINDOW` 的显式本地值、Core 模型的显式 `default_params.context_window`、已有持久绑定均继续生效。没有修改真实用户模型数据库或宣称供应商容量被扩大。若当前 Mon 绑定仍为旧窗口，需调整该模型的显式配置并重新确认；重启不会擅自覆盖用户原设置。

## 独立资源与构建

`npm run setup:video -- --python <python.exe> --ffmpeg-dir <FFmpeg发行目录>` 从现有 Python 基础发行复制独立解释器，只在副本安装固定依赖；默认输出 `Data/runtime/video-context`，拒绝覆盖，支持 `--output` 和复用 tiny 模型的 `--model-dir`。不修改 Core 虚拟环境。当前自动组装器仅实现 Windows，其他平台需要手动准备兼容 `runtime.json`。

本机已安装 Python 3.12.6、FFmpeg／FFprobe 9.0.2 和 multilingual Whisper tiny。运行代码不依赖 `.artifacts`、参考仓库或它们的虚拟环境。Server 构建复制源码和许可；发行复制独立 Python、FFmpeg、模型及许可，缺少运行时则打包失败。复制后的 Python 经过搬迁位置的实际启动验证。首次打包测试在 15 秒握手预算内超时；视频专用冷启动预算调整为 60 秒后通过，普通 MCP 默认仍为 15 秒。尚未确认首次载入和并发负载各自的影响，不将超时直接归因于安全扫描。

## 验证命令与证据

使用固定 Node 22.23.1 和独立临时数据库／目录：

```text
node Script/Test/run_typescript_tests.mjs Server/tests/integration/video Server/tests/unit/video
node Script/Test/run_typescript_tests.mjs packages/runtime-pi/tests
node Script/Test/run_typescript_tests.mjs Server/tests/integration/capabilities
node Script/Test/run_typescript_tests.mjs Server/tests/integration/mon packages/integrations/tests
E:/EDEN/DLC/BotLauncher/.venv/Scripts/python.exe -m unittest tests.test_qq_video_input tests.test_group_file_input tests.test_qq_file_delivery tests.test_qq_image_delivery
node --test Script/Project/video_artifact.test.mjs
node node_modules/typescript/bin/tsc -p tsconfig.server.json --noEmit
node Script/Architecture/check.mjs
node Script/Project/build_server.mjs
```

BotCore 命令从 `E:/EDEN/DLC/BotLauncher/BotCore` 运行，其余从 Agent 根运行。日志和样本位于 `.artifacts/video-context-20261022/`。视频专项包含真实 FFmpeg 合成四幕视频、真实 Whisper 工作进程、真实 MCP、当前附件、选取时间段、跨回合读取、角色隔离、审批拒绝、输入错误、原文件名恢复、任务删除和原视频保留。256K 回环模型端点确认一次真实取帧后四张 JPEG 出现在后续模型请求，只有两次请求，未因自动压缩丢图；该端点用于录制协议，不能据此宣称真实视觉模型语义理解正确。

另外以此前 24 秒中文配音样本运行完整内置工具链，`status=complete`、`transcript_status=complete`，1／7／13／19 秒分别为红方块、绿圆、蓝三角和黄星；四张图片已实际查看，标签 ALPHA／BRAVO／CHARLIE／DELTA 顺序正确。tiny 转写仍把“绿色圆形”识别成“預測原型”等，不能宣称逐字准确。输出见 `speech-and-frames.json` 和 `frame-1.jpg` 至 `frame-4.jpg`。

最终验证结果：

| 检查范围 | 结果 |
| --- | --- |
| 视频专项（边界、真实引擎和模型窗口） | 10 通过，0 跳过 |
| runtime-pi 回归 | 85 通过 |
| 宿主能力与技能 | 22 通过 |
| Mon／QQ 与 MCP 集成 | 68 通过 |
| BotCore 视频、图片和文件接收 | 20 通过 |
| 搬迁后真实 Python／媒体依赖启动 | 1 通过 |
| 桌面回执纯函数及输入仲裁单元回归 | 5 通过；不发送桌面输入 |
| 合计 | 211 项通过 |
| Server TypeScript | 通过 |
| 架构 | 1,257 源码文件，0 错误；保留既有规模警告 |
| Server 构建 | 通过 |

首次失败包括测试夹具把 QQ 会话放入 local 世界、群工具白名单期望未加入新工具，以及原文件名恢复后的旧断言，均已对应修正并复跑。首次组装独立 Python 时继承了基础发行的 EXTERNALLY-MANAGED 标记，安装器改为不复制该标记后安装成功；原解释器没有变化。

最终检查发现同期桌面 `projectDriverAction` 的圈复杂度为 16，超过工程门槛。仅把原有事实字段投影提取成私有纯函数，保留状态判断优先级与所有分支，相关 5 项单元测试、Server 类型和架构重新通过；没有进行真实桌面输入。

自动审批以 `blocked by policy` 拒绝删除本轮首次失败的临时安装目录 `Data/runtime/video-context.staging-dcf6f1b9-f86a-41c3-9cc9-12894d6a18ff`。没有重试或绕过该删除，残留目录保留；实际使用的是已完成的 `Data/runtime/video-context`。该拒绝不影响运行时与验证结果。

## 使用和验收边界

本轮没有重启在线 Agent／QQBot，没有向真实 QQ 发消息，没有调用生产或付费视觉模型；真实用户数据库不作测试夹具。新能力需重启对应宿主和 BotCore 后生效。当前模型必须支持图片输入。

YouTube 入口复用固定引擎，但本轮未进行真实在线下载验收；B站、抖音、任意网页链接下载和 GIF 转视频尚未适配。长视频受限时限制，需按时间范围分段。保留最终业务迁移验收标准，不将本轮专项通过等同于全部 P0–P5 完成。
