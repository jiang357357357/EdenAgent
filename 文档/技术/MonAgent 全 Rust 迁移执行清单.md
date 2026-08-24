# MonAgent 全 Rust 迁移执行记录

状态：架构代码切换完成（不等同于完整产品功能验收）  
完成日期：2026-08-19  
目标方案：[MonAgent 全 Rust 服务端长期架构方案](./MonAgent%20全%20Rust%20服务端长期架构方案.md)

> 本文件记录 Python host/sidecar 到单进程 Rust 架构的切换历史。完整产品能力迁移尚按 [MonAgent 全 Rust 完整功能迁移计划](./MonAgent%20全%20Rust%20完整功能迁移计划.md) 和 [MonAgent 归档行为验收矩阵](./MonAgent%20归档行为验收矩阵.md) 持续验收；不得用本文件中的“完成”替代逐项运行证据。

## 1. 最终结论

MonAgent 的产品运行链已经迁移为单一 Rust Server：

```text
frontend/web + Electron
          │
          ▼
mon-agent-server（Axum / Tokio / SQLite）
          │ Cargo path dependencies
          ▼
AgentCore Rust library crates
```

- `AgentCore` 是可嵌入 Rust 库，不是动态库、Python 扩展或 sidecar。
- `Server` 是 Rust 项目，也是唯一后端进程。
- Server/Core 之间只有进程内 Rust API，不存在 NDJSON/stdio 私有协议。
- Web 只访问 WebSocket JSON-RPC 与 Blob HTTP；旧 REST/SSE Agent API 已删除。
- Electron 只启动和监控 `mon-agent-server`，并通过私有 token 文件完成能力令牌交付。
- 产品构建、运行与 OpenTTD 辅助启动均不依赖 Python。

## 2. 已完成能力矩阵

| 领域 | 最终实现 | 状态 |
|---|---|---|
| Workspace | 根 `Cargo.toml` / 单一 `Cargo.lock` | 完成 |
| AgentCore | `mon-agent-domain`、`mon-agent-core`、`mon-agent-tools` | 完成 |
| Server | `mon-agent-server` Rust binary，直接依赖 AgentCore | 完成 |
| 客户端协议 | 鉴权 WebSocket JSON-RPC、版本协商、Origin 校验、Blob HTTP | 完成 |
| 类型生成 | Rust API catalog 生成 TypeScript RPC client/types | 完成 |
| 会话运行 | 每会话 actor、有界队列、取消、恢复、durable inbox | 完成 |
| 持久化 | SQLite WAL、顺序事件、会话参与者、权限、问题、媒体、jobs、blobs | 完成 |
| 模型 | OpenAI-compatible 流式 provider、reasoning、tool call、用量与取消 | 完成 |
| 上下文 | token 预算、自动/手动 compaction、检查点重建 | 完成 |
| 本地工具 | read/ls/find/grep/write/edit/patch/diff/shell | 完成 |
| 权限 | restricted/full_access/takeover、持久化审批、最后匹配规则 | 完成 |
| 沙箱 | Linux bubblewrap/外部 wrapper；不可用平台的命令执行 fail closed | 完成 |
| 技能 | 发现、读取、启停、本地/Git 预检安装、创建、原子更新、卸载 | 完成 |
| 多智能体 | 持久化 agent 树、深度/并发限制、FIFO mailbox、等待/中断 | 完成 |
| Mon 宿主 | 助手、角色动作/贴纸、视觉、QQ、邮件、自醒日记 | 完成 |
| 记忆与备忘 | memories、memos、提醒、snooze、due dispatch、next wake | 完成 |
| 后台作业 | SQLite jobs、租约、重试、jobId 输入去重、统一会话入口 | 完成 |
| 连接器 | Lichess 原生 Rust client；OpenTTD 原生 Admin Port + GameScript bridge | 完成 |
| 媒体 | Blob 上传、屏幕/摄像头请求与持久化响应 | 完成 |
| Web | `agent-client.ts` + 生成 RPC transport，无 Agent REST/SSE 兼容层 | 完成 |
| Electron | 单 Rust Server 生命周期、token、私有数据库/blob/skills 路径 | 完成 |
| 脚本 | Cargo 启动/检查；OpenTTD 使用 Node 辅助脚本 | 完成 |
| 旧实现 | Python Server、uv、sidecar、旧协议 crate 与打包链退出工作区 | 完成 |

## 3. 关键可靠性与安全规则

- 输入先提交到 `session_inputs`，再唤醒 actor；内存 channel 不是事实源。
- 服务启动时恢复 claimed inputs，单会话同一时刻只运行一个 turn。
- 定时任务通过稳定 `jobId` 建立唯一输入；租约过期不会创建第二条输入，中断输入可显式重排。
- 权限决定先写 SQLite 再释放工具；写文件、外部发送和连接器动作默认需要审批。
- 命令工具没有 OS 沙箱时拒绝注册，绝不静默降级为裸执行。
- 本地文件工具 canonicalize 路径并限制在固定 workspace root 内。
- Server 默认监听 `127.0.0.1:40092`；RPC 与 Blob 强制 capability token，RPC 同时校验 Origin。
- 附件使用内容寻址 Blob；Web 不取得任意本地文件路径。
- Mon Core、模型和连接器凭证由宿主读取，不进入普通工具环境或提示词。

## 4. 有意固定的产品边界

这些不是未完成兼容层，而是新架构的明确约束：

- workspace root 和模型配置在 Server 进程生命周期内固定；修改启动配置后重启。前端不再展示无法兑现的热切换能力。
- TTS/STT 仍可由前端通过已登录的 Mon Core 会话调用；这是 Mon 业务边界，不是旧 Agent Server API。
- OpenTTD Rust connector 直接实现 Admin Port；项目内 Squirrel GameScript 只负责 OpenTTD 引擎允许的公司玩法命令，不是后端 sidecar。
- Windows 当前没有内置的等价命令沙箱，因此 shell fail closed；可通过 `MON_AGENT_SANDBOX_EXECUTABLE` 配置经过审计的外部隔离器。
- macOS 同样在没有合格 wrapper 时拒绝命令执行。文件工具仍受 workspace 边界与审批约束。

## 5. 删除与可恢复归档

以下内容已移出 `D:\Mon\Agent`，归档到：

```text
D:\Mon\归档\AgentMigrationArchive_20260819
```

归档包括：Python Server 源码与测试、venv/cache、`pyproject.toml`、`uv.lock`、Python 启动脚本、sidecar 发布目录、`mon-agent-protocol`、`mon-agent-runtime`、旧打包脚本和旧迁移说明。

归档是可恢复的，但不属于 Cargo workspace、npm workspace、开发启动链或发布物。确认不再需要历史对照后可由维护者另行删除；本次迁移没有执行不可恢复删除。

## 6. 验证记录

在 Windows 工作区 `D:\Mon\Agent` 执行并通过：

| 命令 | 结果 |
|---|---|
| `cargo fmt --all -- --check` | 通过 |
| `cargo check --workspace` | 通过 |
| `cargo test --workspace` | 67 个 Rust 单元/集成测试通过，doc tests 通过 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 通过，零告警 |
| `cargo build --workspace --release` | 通过 |
| `npm run generate:rpc` | 生成成功 |
| `npm --prefix frontend/web run typecheck` | 通过 |
| `npm --prefix frontend/web run test` | 137 项通过 |
| `npm --prefix frontend/web run build` | 生产构建通过 |
| `npm --prefix frontend/desktop test` | 119 项通过 |
| `npm run lint` | 通过，零告警 |
| `node --check Script/Project/openttd_launcher.mjs` | 通过 |
| OpenTTD helper `uuid` / 双端口分配 | 通过 |

Rust Server 集成测试还覆盖：缺失 token 拒绝、非法 Origin 拒绝、协议版本拒绝、session/turn durable flow、直接链接 Core 版本和 loopback HTTP health。

本机无法替代 Linux/macOS 实机发布认证。跨平台代码采用 `cfg` 和 fail-closed 行为；Linux OpenTTD Bash 启动器及 macOS/Windows 沙箱 wrapper 仍应由对应平台 CI/发布机做最终认证。这是发布矩阵工作，不再涉及 Python/sidecar 迁移。

## 7. 最终入口

开发启动：

```powershell
npm run dev
```

仅启动 Server：

```powershell
npm run dev:server
# 或
cargo run -p mon-agent-server
```

生成前端协议：

```powershell
npm run generate:rpc
```

发布构建：

```powershell
cargo build --workspace --release
npm --prefix frontend/web run build
```

## 8. 完成判定

P0 至 P7 的代码迁移均已完成。当前主线不存在 Python Server、AgentCore sidecar、Server/Core 私有进程协议或旧 Agent REST/SSE 兼容链。后续工作属于功能迭代、平台发布认证与性能优化，不再属于本次架构迁移。
