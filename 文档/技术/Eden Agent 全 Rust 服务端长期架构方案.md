# Eden Agent 全 Rust 服务端长期架构方案

状态：已实施（2026-08-19）  
适用范围：`D:\Mon\Agent` 未来主线  
原则：不保留 Python Server、stdio sidecar、旧 HTTP 接口或旧数据格式的运行时兼容性

## 1. 结论

长期应当采用以下结构：

- `AgentCore` 保持为可嵌入的 Rust 核心库集合，负责智能体领域模型、事件循环、上下文、工具调度、技能和多智能体运行时。
- `Server` 重写为 Rust 应用，通过 Cargo 直接依赖 `AgentCore` 中的 crates。
- 最终产品只有一个 `eden-agent-server` Rust 服务进程，不再由 Python 启动 sidecar，也不再通过 NDJSON/stdio 在 Server 与 AgentCore 之间通信。
- Web/Electron 使用一个重新设计的、强类型的本地客户端协议访问 Rust Server。
- Python 实现只在重写期间作为行为参考，完成切换后从发布物和主运行链路中移除。

这里的“AgentCore 作为模块”不应理解为一个由 Server 动态加载的 DLL、Python 扩展或独立进程，而应理解为一组有明确边界的 Rust library crates。Server 在编译期链接这些 crates：

```text
frontend/web ─┐
              ├─ WebSocket/HTTP ─> eden-agent-server
Electron ─────┘                         │
                                       ├─ eden-agent-core
                                       ├─ eden-agent-domain
                                       └─ eden-agent-tools
```

这是比“Python Server 导入 Rust”“Rust Server 再调用 sidecar”更适合长期维护的形态。

实施结果：仓库根现在是唯一 Cargo workspace；`Server` 是 `eden-agent-server` Rust binary，并以 path dependency 直接链接 `eden-agent-domain`、`eden-agent-core` 与 `eden-agent-tools`。客户端只使用鉴权 WebSocket JSON-RPC 和 Blob HTTP 端点。原 Python Server、旧协议 crate、runtime sidecar、uv 配置与打包脚本均已退出工作区。旧源码被可恢复地归档到 `D:\Mon\归档\AgentMigrationArchive_20260819`，不参与构建或运行。

最终组合关系如下：

```text
Web / Electron
      │  authenticated WebSocket JSON-RPC + Blob HTTP
      ▼
eden-agent-server (Rust)
      ├─ eden-agent-app / store / provider / sandbox
      ├─ host / skills / multiagent / connectors / interaction
      └─ AgentCore library crates（进程内直接调用）
```

## 2. 迁移前基线与已消除的问题

迁移前链路为：

```text
Web / Electron
      │
      ▼
Python Server
      │ NDJSON over stdio
      ▼
eden-agent-runtime sidecar
      │
      ▼
AgentCore crates
```

迁移前 Python Server 约有 2.85 万行 Python，复杂度主要集中在 `runtime`、`tools`、`skills`、`connectors`、`llm`、`http`、`store` 和 `native_runtime`。`AgentCore` 当时包含 `eden-agent-protocol` 与 `eden-agent-runtime` 两个过渡 crate；它们现已移除。

这套结构在迁移期有价值，但不适合作为最终结构；以下问题已通过本次迁移消除：

- Server 与 AgentCore 之间需要重复定义状态、事件、错误和生命周期。
- stdio 协议把进程内调用变成序列化、反序列化和子进程管理问题。
- Agent 调度职责可能同时存在于 Python 和 Rust，容易出现两个事实源。
- 权限、取消、流式事件和崩溃恢复跨进程后更难保证原子性。
- Python、Rust 两套构建和分发链增加桌面端安装、诊断和升级成本。
- 为旧接口持续做适配，会让新领域模型被旧 API 形状反向约束。

因此，本方案把当前结构视为过渡实现，而不是需要维护兼容性的产品边界。

## 3. 目标架构原则

### 3.1 单一事实源

每类状态只能有一个权威拥有者：

- Agent 运行状态由 AgentCore 拥有。
- 会话、输入、事件和投影的持久化由 Server 拥有。
- 权限决策由 Server 的策略与审批模块拥有。
- 前端只展示服务端状态，不自行推断运行状态。

### 3.2 单向依赖

依赖方向固定为：

```text
Server application
    │
    ├──> Server infrastructure crates
    │
    └──> AgentCore public crates
              │
              └──> domain abstractions
```

`AgentCore` 不得依赖 `Server`，也不得知道 HTTP、WebSocket、SQLite、Electron、Mon 用户系统或具体连接器的存在。

### 3.3 进程内组合，边界处使用 trait

同一产品中的核心与宿主通过 Rust API 和 trait 组合，不用内部 RPC。只有真正位于进程外的系统才使用网络或子进程协议，例如模型提供商、Mon Core、浏览器或第三方连接器。

### 3.4 持久化先于执行

用户输入必须先被可靠写入，再唤醒会话执行。任何会影响模型上下文、工具副作用或用户可见状态的事实，都必须能从持久化事件中恢复。

### 3.5 权限与隔离是两个层次

用户批准回答“是否允许做”，操作系统沙箱回答“进程实际上能做什么”。批准不能代替沙箱，沙箱也不能代替清晰的批准记录。

## 4. 推荐仓库结构

建议将仓库根目录变成唯一 Cargo workspace，避免嵌套 workspace：

```text
D:\Mon\Agent
├─ Cargo.toml                         # 唯一 workspace 根
├─ AgentCore
│  └─ crates
│     ├─ eden-agent-domain             # 新增：稳定领域类型和端口
│     ├─ eden-agent-core               # Agent 状态机与事件循环
│     └─ eden-agent-tools              # 工具定义、注册与调度抽象
├─ Server
│  ├─ Cargo.toml                      # eden-agent-server 二进制
│  ├─ src
│  └─ crates
│     ├─ eden-agent-api                # 客户端协议与传输
│     ├─ eden-agent-app                # 应用编排、会话 actor
│     ├─ eden-agent-store              # SQLite、事件日志、投影
│     ├─ eden-agent-provider           # 模型提供商
│     ├─ eden-agent-sandbox            # 权限执行与 OS 隔离
│     └─ eden-agent-connectors         # Mon 与外部连接器
├─ frontend
│  ├─ web
│  └─ desktop
└─ Script
```

根 workspace 示例：

```toml
[workspace]
resolver = "2"
members = [
  "AgentCore/crates/eden-agent-domain",
  "AgentCore/crates/eden-agent-core",
  "AgentCore/crates/eden-agent-tools",
  "Server",
  "Server/crates/*",
]
```

`Server/Cargo.toml` 直接使用 workspace 依赖或路径依赖：

```toml
[dependencies]
eden-agent-domain.workspace = true
eden-agent-core.workspace = true
eden-agent-tools.workspace = true
```

不建议继续保留 `AgentCore/Cargo.toml` 作为另一个 virtual workspace。一个仓库只保留一个 workspace，能统一锁文件、依赖版本、lint、测试、交叉编译和发布。

如果未来需要把 AgentCore 单独分发，应优先将 crates 做语义化版本并发布到私有 registry；只有当组织、发布节奏和权限确实分离时才拆仓库。当前阶段用 monorepo workspace 的成本最低、约束最强。

## 5. AgentCore 的职责

### 5.1 `eden-agent-domain`

这个 crate 只放稳定、无基础设施依赖的领域类型和端口：

- `SessionId`、`TurnId`、`ItemId`、`AgentId`、`ToolCallId`。
- 消息、内容块、工具调用、工具结果、用量和停止原因。
- Agent 配置、工具描述、技能描述、上下文快照。
- 领域事件和错误分类。
- 核心所需的 trait，不放具体数据库或网络实现。

它应当是整个 workspace 最稳定的一层，并尽量避免依赖 Tokio、Axum、SQLx 等框架。

### 5.2 `eden-agent-core`

负责：

- Agent/turn 状态机。
- 模型调用与工具调用之间的事件循环。
- 消息归一化和模型上下文构建。
- 上下文预算、截断、压缩和摘要检查点。
- 取消、steer、follow-up 输入和生命周期控制。
- 子智能体创建、通信、等待和回收。
- 生成结构化领域事件。

它通过注入的端口使用宿主能力，例如：

```rust
#[async_trait]
pub trait ModelProvider: Send + Sync {
    async fn stream(&self, request: ModelRequest)
        -> Result<ModelStream, ProviderError>;
}

#[async_trait]
pub trait ToolExecutor: Send + Sync {
    async fn execute(&self, request: ToolExecutionRequest)
        -> Result<ToolExecutionResult, ToolError>;
}

#[async_trait]
pub trait AgentEventSink: Send + Sync {
    async fn append(&self, event: AgentEvent) -> Result<(), EventSinkError>;
}
```

实际签名可以在实现时调整，但边界必须保持：Core 描述需求，Server 提供实现。

### 5.3 `eden-agent-tools`

负责：

- 工具 schema、注册表和发现。
- 参数解析与验证。
- 工具元数据，包括只读/写入、网络、命令执行和可并行性。
- 内建工具的 Rust 实现。
- 工具结果标准化和输出大小控制。

工具策略、用户审批、OS 沙箱和密钥注入属于 Server。工具 crate 可以声明所需能力，但不能自行绕过宿主执行策略。

### 5.4 移除的 AgentCore 目标组件

- `eden-agent-runtime` 不再作为生产 sidecar。若开发者确实需要 CLI，可另建薄的 `eden-agent-cli`，但它不是 Server 的依赖路径。
- 当前 `eden-agent-protocol` 所表示的 Server-runtime NDJSON 协议应移除。客户端协议由新的 `eden-agent-api` 定义。
- Core 内不能残留“是否由 Python 宿主调用”的分支。

## 6. Rust Server 的职责

Rust Server 是产品宿主和 composition root，负责：

- 进程启动、配置读取、依赖装配和优雅关闭。
- HTTP/WebSocket 服务、鉴权、连接管理和背压。
- 会话注册表、每会话 actor 和跨会话调度。
- SQLite 事件存储、输入队列、物化投影和 blob 存储。
- 模型提供商适配、密钥管理、限流、重试和遥测。
- 权限策略、审批请求、审计和 OS 沙箱。
- Mon Core、业务工具和第三方连接器。
- 定时任务、自唤醒和后台作业。
- 结构化日志、指标、诊断包和健康检查。

Server 不重新实现 Agent 事件循环。它只负责可靠地承载 Core，并将外部输入转换为 Core 命令、将 Core 事件转换为持久化记录和客户端通知。

## 7. 运行模型

### 7.1 每会话一个 actor

建议每个活跃会话由一个 Tokio task 串行处理状态变更：

```text
durable input inbox
        │
        ▼
session actor ──> AgentCore turn loop ──> domain events
        │                                  │
        └──────── cancellation/control ────┘
```

约束如下：

- 一个会话同一时间最多有一个活跃 turn。
- 不同会话可以并发运行。
- 输入通过有界 channel 唤醒 actor，但 channel 不是事实源；SQLite inbox 才是事实源。
- 服务过载时明确返回 `busy` 或排队状态，不能使用无限队列。
- mutate 类工具默认按 workspace 串行；明确标记安全的只读工具可以并行。

### 7.2 输入生命周期

推荐状态：

```text
received -> persisted -> admitted -> claimed -> completed
                                      └-------> interrupted
```

客户端得到“已接受”响应前，输入必须已经提交到数据库。服务崩溃后，未完成输入由恢复器重新放入会话调度。

### 7.3 工具副作用

工具执行至少记录：

```text
ToolExecutionPlanned
PermissionRequested / PermissionResolved
ToolExecutionStarted
ToolExecutionCompleted | ToolExecutionFailed | ToolExecutionInterrupted
```

如果服务在 `Started` 后崩溃且没有终态，恢复时标记为 `Interrupted`，不能自动重放写文件、执行命令、发送请求等有副作用操作。客户端或 Agent 必须显式决定是否重新执行。

所有请求携带稳定的 `operation_id`，支持具备幂等能力的连接器去重。

## 8. 持久化设计

### 8.1 SQLite 作为本地事实源

建议使用 SQLite WAL 模式。核心表至少包括：

- `sessions`：会话元数据和当前投影版本。
- `session_inputs`：可靠输入队列及其处理状态。
- `session_events`：按 `(session_id, seq)` 排序的追加事件日志。
- `turns`、`items`、`messages`、`tool_runs`：查询投影。
- `permission_requests`、`permission_decisions`：审批与审计。
- `agents`、`agent_links`：父子智能体关系。
- `jobs`：定时任务和自唤醒作业。
- `blobs`：大对象元数据，内容可存独立文件。

事件日志记录行为历史，投影负责快速查询。不要让“JSON 会话文件”和 SQLite 同时成为权威来源。

### 8.2 事件持久化规则

- 任何进入模型可见上下文的内容都必须已经持久化。
- 用户消息、最终 assistant 消息、工具调用、工具结果、turn 边界和压缩检查点必须持久化。
- 高频 token delta 可以只实时推送或分批记录，不要求逐 token 事务写入。
- 最终消息必须能独立恢复，不能依赖客户端拼接 delta。
- 压缩生成新的 summary/checkpoint，但原始事件保留，便于审计和重建。

### 8.3 Blob 和附件

附件、大型工具输出和图像采用内容寻址存储：

- 数据库存 hash、大小、MIME、创建者和引用关系。
- 文件放在应用数据目录，不写入 workspace。
- API 使用不可猜测 ID，不向 Web 前端暴露任意本地路径。
- 删除由引用计数或保留策略完成。

## 9. 新客户端协议

### 9.1 传输选择

推荐：WebSocket 上的 JSON-RPC 2.0 风格消息，HTTP 只保留健康检查、就绪检查和 blob 上传/下载。

原因：智能体运行天然是双向的。Server 不只推送 token，还会主动发起权限请求、用户问题、警告和状态变更。单一长连接比 REST + SSE + 轮询更容易表达完整生命周期。

### 9.2 方法分组

建议从以下新接口开始，不复刻旧接口：

- `initialize`
- `session.create`、`session.list`、`session.read`、`session.close`
- `turn.start`、`turn.cancel`、`turn.steer`
- `permission.resolve`
- `question.resolve`
- `model.list`
- `config.read`、`config.update`
- `connector.list`、`connector.control`
- `blob.create`、`blob.read`

服务端通知建议包括：

- `session.event`
- `turn.started`、`turn.completed`
- `item.started`、`item.delta`、`item.completed`
- `permission.requested`
- `question.requested`
- `server.warning`

### 9.3 类型生成

Rust 类型是协议唯一来源：

- `serde` 负责序列化。
- `schemars` 生成 JSON Schema。
- `ts-rs` 或同类工具生成 TypeScript 类型。
- 前端使用生成的 client/types，不手工复制事件联合类型。

即使不兼容旧协议，新协议也应在 `initialize` 中携带 `protocol_version` 和 capabilities，以便未来可控演进。

### 9.4 本地服务安全

- 默认只监听 `127.0.0.1`，不是 `0.0.0.0`。
- Electron 启动 Server 时生成高熵 capability token，并通过受控启动参数或安全 IPC 传递。
- 每个 WebSocket 和 HTTP 请求都必须鉴权。
- 校验 `Origin`，不使用通配 CORS。
- 浏览器不能提交任意本地路径；文件访问通过受限选择器和 blob ID。
- 对消息尺寸、连接数、队列长度和请求频率设置上限。

如未来需要局域网或远程访问，应作为独立部署模式设计 TLS、用户身份和设备配对，不能通过把默认地址改为 `0.0.0.0` 实现。

## 10. 权限与沙箱

### 10.1 策略层

策略统一为 `allow | ask | deny`，规则可限定：

- session、agent、tool。
- 文件路径或命令模式。
- 只读、写入、命令、网络等能力。
- 单次、当前 turn、当前会话或持久范围。

匹配顺序必须明确并可测试，例如“最后匹配规则生效”。没有规则时对副作用操作 fail closed。

审批请求绑定经过鉴权的连接、session、turn、item 和 operation，批准结果先持久化再执行。

### 10.2 执行层

所有写文件和执行命令都必须同时经过策略判定和 OS 级限制：

- 路径先 canonicalize，再验证允许的读写根目录。
- 子进程使用最小环境变量，不继承全部密钥。
- Linux 使用 Landlock、bubblewrap 或等价隔离。
- macOS 使用 Seatbelt 或等价隔离。
- Windows 使用受限 token、Job Object、ACL 和进程树控制。
- 不支持的平台或初始化失败时拒绝高风险工具，不能静默退化为无沙箱执行。

模型提供商密钥和连接器凭证只能由宿主在最后一刻注入，不能进入 prompt、普通事件日志或工具可见环境。

## 11. 多智能体设计

每个子智能体应是一个持久化的子会话，而不是主会话中的临时 future：

- 保存 `parent_agent_id`、角色、模型、工具集合、权限配置和创建原因。
- 子智能体拥有自己的事件流、上下文预算和可靠 inbox。
- 同一个子智能体最多一个 live activation，可冷恢复。
- 消息按 FIFO 进入 inbox，发送成功以数据库提交为准。
- 默认只有直接父智能体可控制子智能体。
- 设置最大深度、最大并发数、最大存活时间和 token/费用预算。
- 等待子智能体是可取消操作，不占用无限线程或无限 channel。

不要再单独维护临时 mailbox JSON 文件；多智能体通信复用统一的事件日志和输入队列。

## 12. 技能、连接器和自唤醒

### 12.1 技能

技能解析属于 AgentCore，来源发现和文件访问属于 Server：

- Server 在允许的 roots 中发现技能并读取资源。
- Core 解析 frontmatter、指令、依赖和触发规则。
- 技能加载结果带内容 hash，保证一次 turn 使用稳定版本。
- 技能引用的文件仍受路径与权限策略约束。

### 12.2 连接器

连接器是 Server 基础设施：

- 统一实现连接生命周期、认证、重试、限流、超时和熔断。
- 对 Core 暴露标准工具或资源接口。
- 每个连接器明确声明网络、凭证和副作用能力。
- 连接器失败不得破坏 session actor；错误转换为结构化结果。

Mon Core 也应通过正式 Rust client 接入，避免在 Core 中散落 Mon 业务调用。

### 12.3 自唤醒和后台任务

不要依赖永不退出的内存循环。所有定时或条件触发任务写入 `jobs` 表：

```text
job due -> scheduler claims -> enqueue durable session input -> normal agent path
```

通过租约、重试计数和幂等键实现崩溃恢复。自唤醒最终仍然是一个可审计的会话输入，不创建第二套 Agent 执行机制。

## 13. 模型提供商层

统一 provider trait，但保留各提供商能力差异：

- 流式文本、reasoning、工具调用和结构化输出。
- 模型上下文长度、最大输出、缓存和计费信息。
- API 错误分类、可重试性和退避。
- provider-specific 请求参数，放在受控扩展字段中。
- 取消时主动关闭上游响应流。

不要追求把所有模型压平成最低公共能力。Core 基于 capability 决定可用行为，Provider 对不支持的能力返回明确错误。

为每个 provider 建立录制后的协议 fixture 和契约测试，避免重写时只能依赖真实 API 验证。

## 14. 可观测性和故障边界

- 使用 `tracing`，所有 span 带 session、turn、item、tool 和 operation ID。
- 日志默认不记录 prompt、文件内容、密钥和完整工具输出。
- 指标覆盖活跃会话、队列深度、首 token 延迟、turn 时长、工具失败、provider 重试和数据库延迟。
- 提供本地诊断包导出，但导出前做敏感信息清理。
- 单个 session panic 或工具失败不能终止整个服务；边界 task 捕获故障并写入终态事件。
- 数据库不可用、事件无法提交或沙箱初始化失败时，服务进入 not-ready，拒绝继续执行副作用。

单进程不意味着所有故障都共享命运。外部命令和高风险工具仍然在受控子进程中运行，但 AgentCore 不再是一个常驻 sidecar。

## 15. 推荐技术栈

| 领域 | 推荐 |
|---|---|
| 异步运行时 | Tokio |
| HTTP/WebSocket | Axum + Tower |
| 序列化 | Serde |
| Schema/TS 类型 | Schemars + ts-rs 或等价工具 |
| 本地数据库 | SQLite + SQLx，WAL 模式 |
| HTTP client | Reqwest + rustls |
| 日志和追踪 | tracing |
| 密钥内存处理 | secrecy + zeroize |
| 错误建模 | thiserror；应用边界可用 anyhow |
| CLI/config | clap + 分层配置解析 |

依赖应按 crate 边界集中管理，不让 Axum、SQLx 或具体 provider SDK 渗透到 AgentCore。

## 16. 一次性重写路径

这里的“不考虑兼容”指不设计双协议、代理层、双写数据库或长期 Python 回退；不意味着一次提交重写全部代码。工程上仍应分阶段构建，每个阶段产出可验证的目标态组件。

### 阶段 1：建立 workspace 与领域边界

- 在仓库根建立 Cargo workspace。
- 新增 `eden-agent-domain`。
- 整理 Core 公共 API，消除对 sidecar 协议形状的依赖。
- 为现有关键行为建立 fixture 和测试语料。

完成条件：Core 可由普通 Rust 测试宿主直接构造和运行，不启动进程。

### 阶段 2：建立 Rust Server 骨架

- 创建 `eden-agent-server`、`eden-agent-api`、`eden-agent-app`。
- 实现配置、进程生命周期、健康检查、鉴权 WebSocket 和 schema 生成。
- 定义全新的请求、响应、通知和错误模型。

完成条件：前端测试客户端可建立鉴权连接并完成空会话生命周期。

### 阶段 3：实现可靠会话和存储

- 建立 SQLite migrations、事件日志、投影和 durable inbox。
- 实现 session registry、每会话 actor、取消和崩溃恢复。
- 建立事件重放与上下文重建测试。

完成条件：在任意输入/turn 边界杀死服务，重启后不会丢输入或产生两个活跃 turn。

### 阶段 4：迁移模型与上下文

- 实现 provider trait 和首批模型提供商。
- 接入流式输出、工具调用、重试、用量和取消。
- 迁移上下文预算、压缩与摘要逻辑。

完成条件：纯对话、多轮压缩、取消和 provider 故障均通过契约测试。

### 阶段 5：迁移工具、权限与沙箱

- 将内建工具逐个改写为 Rust。
- 建立能力元数据、策略判定、审批和审计。
- 完成 Windows/Linux/macOS 沙箱适配和 CI 测试。

完成条件：所有写入和命令路径必须经过审批与沙箱；故障时 fail closed。

### 阶段 6：迁移技能和多智能体

- 接入技能发现、解析、资源读取和版本 hash。
- 实现持久化子会话、消息、等待、取消和额度限制。
- 删除临时 mailbox 和第二套调度状态。

完成条件：父子 Agent 在服务重启后能够恢复关系和未处理输入。

### 阶段 7：迁移业务宿主能力

- 迁移 Mon Core client、角色、记忆、连接器和业务工具。
- 将自唤醒改为 durable jobs。
- 补齐凭证管理、遥测和诊断能力。

完成条件：现有产品能力在新领域模型中重新实现，不借用 Python 运行时。

### 阶段 8：切换前端

- 由 Rust schema 生成 TypeScript client/types。
- Web 前端直接采用新协议和新状态模型。
- Electron 改为启动、监控和关闭单一 Rust Server，并安全传递 token。
- 删除旧 API wrapper，而不是维护适配器。

完成条件：开发和发布链路只访问新协议。

### 阶段 9：移除旧实现

- 删除 Python Server、`pyproject.toml`、uv 运行链路和 Python 启动脚本。
- 删除 `native_runtime`、sidecar 查找和打包逻辑。
- 删除旧 HTTP/SSE 协议、旧前端 API 类型和兼容测试。
- 更新 CI、安装包、开发脚本和文档。

若必须保留历史用户数据，只提供一次性、离线、可回滚的导入工具。导入完成后新服务只读取新 schema；不要把旧数据解析器放入日常运行路径。

## 17. 测试策略

必须覆盖以下测试层级：

- Core 单元测试：状态机、上下文预算、压缩、取消和工具循环。
- 属性测试：事件序列不变量、ID 唯一性、队列顺序和上下文重建。
- 重放测试：同一事件日志产生相同模型可见上下文。
- 崩溃注入：在输入、审批、工具和 turn 生命周期每个边界强制终止进程。
- Provider 契约测试：使用 fixture 验证流式解析和错误分类。
- 协议测试：JSON Schema、生成的 TypeScript 和 Rust round-trip。
- 安全测试：鉴权、Origin、路径穿越、符号链接、环境泄漏和无沙箱失败。
- OS 矩阵：Windows、Linux、macOS 的命令树终止与文件边界。
- 负载测试：多会话、慢客户端、慢 provider、队列上限和背压。
- 端到端测试：Electron 启动 Server、创建会话、审批工具、重启恢复。

发布检查必须验证安装包不包含 Python 解释器、Python Server 或 `eden-agent-runtime` sidecar。

## 18. 明确不采用的方案

### Python Server 通过 PyO3 导入 AgentCore

它能减少 stdio 序列化，但保留 Python 作为生命周期和部署中心；Rust panic、异步运行时、ABI、GIL 和扩展模块打包又引入新耦合。适合作为短期桥梁，不适合作为本方案目标态。

### Rust Server 继续启动 AgentCore sidecar

它保留两个进程、两套生命周期和内部协议，无法获得直接类型共享和事务编排优势。只有强隔离或独立升级是硬需求时才值得；当前 AgentCore 是可信的同产品代码，不需要这一边界。

### 把 AgentCore 全部复制进 Server

这样会失去可嵌入核心的清晰边界，未来 CLI、测试宿主或其他 Mon 产品无法复用。正确做法是 Cargo 直接依赖 library crates，而不是消灭模块边界。

### 保留旧 REST/SSE 接口

旧接口会迫使新运行时继续模拟旧状态和命名，产生永久翻译层。本方案直接切换新的双向协议。

### 新旧数据库双写

双写无法可靠保证两个事实源一致，并放大故障恢复难度。需要历史数据时只做一次离线导入。

## 19. 主要风险与控制

| 风险 | 控制方式 |
|---|---|
| Python 能力面较大，遗漏隐性行为 | 先建立行为清单、fixture 和端到端场景，再按领域迁移 |
| Provider 流式协议边界复杂 | 使用录制 fixture、契约测试和统一错误分类 |
| 跨平台沙箱实现难度高 | 沙箱独立 crate、OS 矩阵 CI、失败时拒绝执行 |
| 单进程故障影响范围扩大 | session task 隔离、panic 边界、子进程工具、durable recovery |
| 前端一次性切换范围大 | 先冻结新协议和生成 client，再按完整垂直流程接入 |
| Rust 初期开发速度下降 | 明确 crate 责任、减少框架层、优先迁移核心主链路 |

最危险的不是重写耗时，而是在迁移期长期保留两套可写运行时。因此应给过渡期设明确终点，禁止新功能继续只加在 Python Server。

## 20. 目标态验收条件

全部满足后，才能称为完成：

- 发布物只有一个主 Rust Server，不依赖 Python，不启动 AgentCore sidecar。
- `Server` 通过 Cargo 直接依赖 AgentCore crates。
- AgentCore 不依赖 Server、HTTP、SQLite、Electron 或 Mon 业务实现。
- 客户端只使用新协议，TypeScript 类型由 Rust schema 生成。
- 本地服务默认 loopback、强制鉴权并校验 Origin。
- 用户输入在执行前持久化，事件可重放出相同模型上下文。
- 崩溃恢复不会丢失已确认输入，也不会自动重复副作用工具。
- 所有 channel、连接、输出和并发都有明确上限和背压。
- 写文件和命令执行同时经过权限审批与 OS 沙箱。
- 子智能体、定时任务和自唤醒使用统一的 durable inbox/event store。
- Windows、Linux、macOS 的核心、安全和端到端测试通过。
- Python Server、旧协议、sidecar 打包和兼容层已从主分支删除。

## 21. 建议立即确认的架构决策

建议直接确认以下决策，作为后续实现不可反复摇摆的基线：

1. 仓库根目录是唯一 Cargo workspace。
2. AgentCore 是 Rust library crates，Server 是直接链接它们的 Rust binary。
3. 目标发布物不包含 Python 和常驻 AgentCore sidecar。
4. SQLite 事件日志与 durable inbox 是会话事实源。
5. 客户端采用鉴权 WebSocket 双向协议，HTTP 只承载少量资源接口。
6. Rust 类型生成 JSON Schema 和 TypeScript client/types。
7. 旧接口、旧存储和旧运行时不提供在线兼容；必要数据通过一次性离线工具导入。

确认这七项之后，第一批实际工作应是“根 workspace + `eden-agent-domain` + Core 进程内 API + Rust Server 空骨架”，而不是先逐文件翻译 Python。这样可以先锁定目标边界，再沿真实端到端链路替换实现。

## 22. 参考现有实现时的取舍

重写时可以继续阅读仓库中的参考项目，但只吸收其稳定设计原则：

- Pi：Agent loop、steer/follow-up 队列和事件流的简洁模型。
- Codex：本地 app-server、双向请求、权限审批和结构化 item 生命周期。
- OpenCode：provider、session、tool 和权限策略的模块化。
- DeepSeek 相关架构资料：长上下文和 Agent 系统分层思路。

不应逐项目照搬协议或目录。Eden Agent 的核心约束是本地嵌入、可靠持久化、严格权限以及与 Mon 业务能力组合，最终设计应以这些约束为准。
