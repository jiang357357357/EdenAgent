# 当前执行策略补充（2026-09-10）

用户要求暂停 OS 沙箱与 Node permission 隔离；插件、连接器和 MCP 现在本机执行。下文涉及沙箱约束与虚拟挂载的描述属于恢复前的设计基线，不代表当前能力。恢复前必须由开发者审阅，详见实施记录 25。审批、版本和资源声明仍为宿主管理规则，不能约束本机代码通过系统 API 自行访问文件或网络。

# Eden Agent 统一插件系统

状态：2026-09-10 连接器统一重构。当前事实来源是 TS 源码和 [连接器实施计划](ts-migration/连接器统一实施计划.md)。原 Rust Server/Native 设计只保留在归档及 Git 历史中，不是活动架构。

## 安装和运行的所有者

统一插件包由 `Server/src/modules/plugin-market` 管理安装、完整性、版本选择、包权限、组件启停和回滚。一个包可以包含技能、连接器、MCP、受控 UI、声明式 Hook。连接器模块只管理具体身份实例、资源授权、事件、操作历史和 worker 生命周期，不另建插件安装与版本机制。

现有单文件工具插件继续使用 `packages/plugin-host` 的草稿、验证、测试、安装和激活流程。它与统一包共享插件身份冲突检查；本轮统一的是连接器组件与插件包，未把旧工具插件的数据表重写为另一套表。智能体写工具插件使用 `eden_plugin`，写含连接器的包使用工作区工具和 `eden_connector_plugin`。二者不允许自行授予权限。

## 连接器包格式

```json
{
  "schemaVersion": 1,
  "id": "example.weather",
  "name": "Weather",
  "description": "Example connector plugin",
  "version": "1.0.0",
  "components": {
    "runtimes": [
      { "id": "weather", "kind": "connector", "manifest": "connector.json" }
    ]
  },
  "permissions": []
}
```

`connector.json` 声明 `id/name/description/icon/version`、`runtime: "node"`、`entrypoints.node`、设置 schema、权限及 `events/queries/actions`。Node 入口是包内路径，不能包含绝对路径、回退或符号链接。构建器输出 `worker/main.mjs` 和内容校验清单。`native_worker` 仅保留显式旧包兼容，官方实现全部使用 `connector`，宿主没有游戏名称分支。

SDK 公开入口为 `@eden/plugin-sdk/connector`。插件定义 `ConnectorDefinition`，`initialize(context)` 返回会话，提供 `health`、`query`、`execute` 和 `close`。`context.publish` 只能发布声明过的事件。帧协议沿用 v1 的四字节大端长度前缀和 JSON，限制帧、队列和事件大小；异常响应不包含私有异常内容。取消动作可能意味着远端结果未知，不能宣称副作用已回滚。

## 两层授权

1. 包级授权绑定包 ID 和确切 revision。缺少必需权限时不能启用；版本选择默认禁用。签名、校验、历史撤销和包快照沿用既有插件仓库规则。
2. 实例授权绑定实例 ID、generation、组件 revision 和解析后的具体资源。即使可选权限已在组件声明，也必须获得当前版本的包授权后才能批准实例资源。修改设置、凭据或版本后旧授权不能继续调用。

安装只消费已经预览并保存的完整包快照；修改源码目录不能替换已经批准的运行内容。禁用、移除、权限撤销或版本变化后，生命周期停止旧进程，调用和网络桥接也重新校验授权。

## 资源绑定与隔离

- 文件读取、目录写入通过 `settings.<字段>` 声明。宿主只挂载明确批准的规范路径，并把设置改写为固定 guest 路径；拒绝私有 Data、受保护目录、符号链接和越界路径。
- HTTP 声明设置字段和默认 URL；支持 HTTPS 或显式 loopback HTTP。TCP 声明 loopback 主机/端口字段，可从批准的注册文件发现；受管注册文件绑定进程启动身份并检查变更。桥接固定目的地址，插件不能自行切换地址。当前网络权限是端点级权限，未实现 HTTP 路径级授权。
- 身份凭据来自当前世界私有数据库，只有批准 `environment.read connector.identityCredential` 的实例获得注入。没有宿主环境变量回退，没有凭据读取 RPC 或模型工具。
- Linux 使用 bubblewrap、prlimit、只读包快照、私有 `/data`、受限内存和独立进程组；网络命名空间不共享。缺少沙箱则拒绝运行。Node 迁移没有取消 OS 隔离。
- MCP 保留自己的传输协议，仍由统一包拥有组件与版本。UI 和 Hook 是声明式数据；不在前端任意执行插件脚本。

## 官方与智能体生成的插件

官方目录 `Server/connectors/official/<id>` 仅保存源码、清单和资产。构建和发行自动发现目录，无固定四名称数组：

```sh
npm run build:connectors
node Script/Project/package_connector.mjs --source /absolute/source /absolute/package
```

官方制品在 `dist/connectors/<id>`，需要在插件管理中预览、安装、批准包权限和启用，再创建连接器实例并批准具体资源。清单可在安装前浏览，但不能绕过插件安装直接执行。原官方实例名称保留为所属插件组件的兼容别名，旧授权不会自动迁移。

智能体创作流程：获取 SDK 说明，编写源码与两份清单，构建，在临时夹具和隔离执行环境测试，预览确切制品，安装为禁用版本，经现有审批流程批准权限后启用。`eden_connector_plugin` 提供 describe/inspect/install/enable/disable/list，不提供自授权限入口。测试由现有工作区命令流程执行，不把“安装成功”或智能体自述测试通过当作测试报告。

## 平台与验收范围

四个官方 TS 插件保留原来的查询、动作和事件声明，HOI4/Victoria 模组及 OpenTTD Squirrel 桥接继续随包或源码交付。Victoria 3 控制探针使用插件内 TS/PowerShell 实现，另外要求 `desktop.input application:victoria3 control`；当前宿主没有 Windows 连接器隔离器，实际 Windows 输入不可视为已支持或已验收。

旧根 Native、四个 Rust worker 及 Cargo workspace 已校验归档至 `Archive/2026-09-10-rust-connectors`。宿主与连接器构建不需要 Cargo；Windows 桌面指针观察器仍使用独立 Rust 构建，与本轮连接器范围不同。

测试只使用内存数据库、临时目录、loopback HTTP/Admin 模拟及真实沙箱进程。真实游戏、真实外部账户和其他 OS 运行另列验收，详情见实施记录。
