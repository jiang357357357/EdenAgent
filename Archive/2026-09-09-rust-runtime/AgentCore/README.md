# AgentCore

AgentCore 是 Eden Agent 的可嵌入 Rust 核心库，不包含服务进程或传输协议。

## Crates

- `eden-agent-domain`：稳定 ID、消息与领域值对象。
- `eden-agent-core`：模型无关的 Agent 循环、上下文压缩、工具注册和执行钩子。
- `eden-agent-tools`：受工作区边界和权限策略约束的本地文件、搜索、补丁与命令工具。

`Server` 通过普通 Cargo path dependency 直接链接这些 crate。进程内调用是唯一生产链路，不再存在 stdio sidecar、独立 runtime 二进制或 Server/Core 私有线协议。

```bash
cargo test -p eden-agent-core -p eden-agent-tools
```

公开 API 应保持宿主无关：HTTP、SQLite、模型供应商凭据、Mon Core、连接器和 UI 交互由 `Server` 拥有。
