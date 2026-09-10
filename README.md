# Eden Agent

本地优先、可持久化、可嵌入的 TypeScript 智能体宿主，使用 pi 公共 SDK。

React / Vite · Electron · Node.js 22.23.1 · SQLite · WebSocket JSON-RPC

**简体中文** · [English](README.en.md)

> TS 迁移仍在进行。源码中已有对话、扩展、双世界业务和迁移发行实现，但近期实现尚未运行验证，不能据此认定 P0–P5 已完成。进度以[实施跟踪](文档/技术/Eden%20Agent%20TS%20迁移实施跟踪.md)和[业务长期计划](文档/技术/ts-migration/业务优先长期计划.md)为准。

Eden Agent 的设计灵感来自《蔚蓝档案》中的“什亭之匣”。这是一个独立的源代码公开项目，与原作及其官方无关联。

## 运行结构

Electron 分别监管伊甸园和尘世两个 Node Server。每个宿主通过 `packages/runtime-pi` 调用 pi；前端通过当前世界的 RPC 和 Blob 端点访问服务。

| 路径 | 职责 |
| --- | --- |
| `Server/src` | TS 宿主、业务服务、传输和启动组装 |
| `packages/runtime-pi` | 唯一直接导入 pi SDK 的适配包 |
| `packages/api` | TS 协议 schema 与共享类型 |
| `packages/store` | SQLite 连接、schema 与迁移基础设施 |
| `packages/plugin-sdk`、`packages/plugin-host` | 智能体自写插件、版本、审批与隔离执行 |
| `packages/execution`、`packages/integrations` | 命令边界与外部集成 |
| `frontend/web`、`frontend/desktop` | React 客户端与 Electron 桌面壳 |
| `Server/connectors/official` | 官方 TS 连接器插件源码、清单和资产 |
| `Archive/2026-09-10-rust-connectors` | 旧 Native helper、Rust worker 和 Cargo workspace |
| `Archive/2026-09-09-rust-runtime` | 原 AgentCore、Rust Server 及历史来源 |

宿主和连接器不依赖 Rust。Windows 桌面的指针观察组件仍保留独立 Rust 构建，不属于连接器机制。

## 双世界与模型

伊甸园默认使用端口 `40092`，尘世使用 `40093`，开发 Web 使用 `40091`。两个宿主拥有独立进程、令牌、数据库、Blob、配置和外部副作用状态；事件先持久化再广播。

新数据默认位于 `Data/realms/mon/v2` 与 `Data/realms/local/v2`。旧数据不会原地升级或自动复制。数据库永久绑定世界，暂存导入尚未完成时正式宿主拒绝启动。

伊甸园模型通过 Mon Core 已验证连接绑定，支持角色和导演的独立配置。尘世使用本地配置或 `EDEN_AGENT_MODEL=provider/model`。子任务独立模型目录分别属于本世界，凭据不会跨世界继承；目录改动不自动改写已创建任务的模型快照。

## 开发入口

需要固定版本 Node.js 22.23.1 与 npm。连接器由 esbuild 打包为隔离 Node worker，不需要 Cargo。Linux 隔离执行依赖 bubblewrap 和 prlimit；Windows 已编写明确授权的本机 PowerShell 执行，未内置 Windows 沙箱；终端可接管理员配置的外部隔离器，插件/MCP/技能的跨平台隔离仍待完成，不能据桌面打包目标推断所有隔离功能可用。

```sh
npm ci
npm --prefix frontend ci
```

按项目需要从 `.monconfig.example` 配置本机 `.monconfig`。不要提交能力令牌、模型密钥、运行配置或真实 Data。

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动两个 TS 宿主、Web 与 Electron |
| `npm run dev:server` | 启动单个 TS 宿主，世界由运行配置决定 |
| `npm run dev:web` | 启动 Web |
| `npm run dev:desktop` | 启动桌面开发环境 |
| `npm run generate:rpc` | 从 TS 契约与浏览器模板生成客户端入口 |
| `npm run build:server` | 构建 TS 宿主及离线迁移工具 |

这些是可用脚本入口，不是本次已经执行成功的命令。当前工作顺序为先完成业务，再集中编写测试；收到明确要求后才执行测试和验收。

## 自写插件

智能体使用 `eden_plugin` 读取开发指南、新建或读取草稿、提交修订、验证、声明测试、安装和激活精确版本。插件开发页提供相同业务入口、源码编辑、差异、运行记录及编辑备份。

覆盖已有草稿需要当前 `draftRevision`；构建产物另有 `revision`，安装要求对应的成功报告。工作区授权由用户明确给予，插件不能自行扩大权限。生成源码不会自动执行，模板也不会自动安装。

当前生成插件为受限单文件 TS 工具，不能把它视为任意 npm 应用。市场组件、MCP 与原生连接器有各自的包生命周期和授权边界。

## 迁移与发行

- [数据迁移操作](文档/技术/ts-migration/数据迁移操作.md)：只读快照、暂存转换、恢复审阅、共同激活与数据根选择。
- [桌面发行操作](文档/技术/ts-migration/桌面发行操作.md)：平台组装、独立签名、文件清单、版本安装和受管启动。
- [项目脚本说明](Script/Project/README.md)：具体源码入口。

发行工作流已改为 TS/Node/Electron 与独立 worker 组装。当前尚未产出或验收本轮签名发行包；自动解压与受管启动源码已接入；系统快捷方式、启动器升级和完整数据升级/回退协调仍需补齐。应用版本回退不会恢复数据库，旧宿主可能拒绝新 schema。

## 权限与数据边界

默认沙箱不可用时拒绝执行。用户可明确开启本机命令执行，但审批策略仍独立生效；本机模式不提供两个世界之间的 OS 文件访问隔离，也不会自动允许 MCP stdio、技能或插件代码绕过沙箱。运行命令结束前不能切换执行边界。

角色二进制资源不随代码仓库分发，可通过独立 `AgentAssets` 仓库管理。第三方角色、Spine、语音、模型、游戏内容和商标不包含在本项目软件授权中。

## 项目文档与许可

[实现方案](文档/技术/Eden%20Agent%20TypeScript%20宿主与%20pi%20实现方案.md) · [工程约束](文档/技术/Eden%20Agent%20TypeScript%20工程约束.md) · [安全策略](SECURITY.md) · [贡献指南](CONTRIBUTING.md) · [版本记录](CHANGELOG.md)

依据 [PolyForm Noncommercial License 1.0.0](LICENSE) 提供非商业源码使用，并非 OSI 定义的开源许可证。商业使用须取得[单独书面授权](COMMERCIAL-LICENSE.md)。历史版本范围见 [LICENSING.md](LICENSING.md)，第三方声明见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 统一连接器插件

连接器使用统一插件包的 `connector` 组件，官方实现也必须经过安装、版本授权和启用。`npm run build:connectors` 自动发现并构建 `Server/connectors/official/*`，制品写入 `dist/connectors/<id>`；`npm run build:server` 同时构建连接器。

在插件管理中从该制品目录预览、安装、批准包权限并启用，再配置连接器实例及具体资源授权。旧连接器实例不会自动继承新插件版本的授权。智能体通过 `eden_connector_plugin` 获取 SDK/构建流程并预览安装自己的 TS 插件，不能自行授予权限。

详见 [连接器实施计划](文档/技术/ts-migration/连接器统一实施计划.md)。Linux 隔离协议已加入真实临时夹具测试；真实游戏、外部账户及 Windows/macOS 不以模拟测试代替验收。Victoria 3 控制探针已编写 TS/PowerShell 适配器并要求独立桌面输入授权，但当前宿主不支持 Windows 连接器隔离，实际 Windows 执行未验收。
