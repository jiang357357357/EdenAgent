# MonAgent mon-agent-app 运行时模块边界

## 定位

`mon-agent-app` 是 Server 内连接持久化服务与 AgentCore 循环的应用编排层。它负责会话串行化、单轮生命周期、上下文恢复与压缩、导演计划执行、流式事件持久化，以及任务完成或失败后的业务收尾。

crate 的公开入口只保留：

- `SessionRuntime`
- `RuntimeError`
- `TurnQueueUpdate`

外部代码继续通过 `mon_agent_app::SessionRuntime` 使用运行时，内部模块不构成公共 API。

## 目录结构

```text
src/
├─ lib.rs                     # crate 门面与公开重导出
├─ director.rs                # 导演计划生成与规范化
├─ memory.rs                  # 长期记忆提取
├─ prompt.rs                  # Prompt 编译与相关内容选择
├─ self_awake.rs              # Self-Awake 领域决策
├─ session_title.rs           # 会话标题生成
└─ runtime/
   ├─ mod.rs                  # SessionRuntime API 与共享服务
   ├─ actor.rs                # 每会话串行队列、取消、转向和追问
   ├─ event.rs                # AgentEvent 标注与稳定 messageId 持久化
   ├─ message.rs              # 用户消息、Blob 附件和文本转换
   ├─ tool_policy.rs          # 不同运行 Profile 的工具白名单
   ├─ context/
   │  ├─ replay.rs            # 历史事件回放与上下文重建
   │  └─ compaction.rs        # 轮前压缩和 AgentLoop 内压缩
   ├─ turn/
   │  ├─ mod.rs               # prepare → execute → finish 协调器
   │  ├─ prepare.rs           # 输入准备与 PreparedTurn
   │  ├─ execute.rs           # 导演 Beat 和 AgentLoop 执行
   │  └─ finish.rs            # 成功、失败、Job、Memo、记忆和标题收尾
   └─ tests/                  # 按事件、压缩、普通轮次和多参与者分类
```

## 依赖方向

```text
SessionRuntime → actor → turn
                         ├─ prepare → context/replay, message, director, prompt
                         ├─ execute → context/compaction, event, tool_policy
                         └─ finish  → memory, self_awake, session_title
```

Actor 不依赖 Prompt、导演或业务完成逻辑。Context、Message、Event 和 Tool Policy 不能反向依赖 Actor。

## 生命周期约束

1. 一个 Session 同时只运行一个 Input。
2. `turn.started` 在处理开始时持久化。
3. `prepare` 可以完成纯压缩请求或已完成的 Self-Awake 恢复请求。
4. `execute` 使用 `ExecutionRequest` 显式携带不可缺少的执行状态。
5. 流式 `message_update` 和 `message_end` 必须复用对应 `message_start` 事件记录 ID。
6. 执行成功后才写入 `turn.completed` 并完成 Input。
7. 失败路径必须写入失败事件、中断 Input，并按原策略安排 Job 重试。
8. Store 事件顺序、事件名和 JSON 字段属于前端与恢复流程使用的兼容契约。

## 修改与验证

修改运行时后至少执行：

```powershell
cargo fmt --all -- --check
cargo check -p mon-agent-app
cargo test -p mon-agent-app
cargo clippy -p mon-agent-app --all-targets --no-deps -- -D warnings
cargo check -p mon-agent-server
```

默认使用 Cargo 增量编译，不执行 `cargo clean`。跨 crate 严格 Clippy 还会检查依赖 crate；若失败，需要区分本 crate 问题与依赖中的既有告警。
