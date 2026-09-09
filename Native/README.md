# 官方连接器原生辅助组件

Agent 循环、业务存储、审批、连接器监管均由 TS 宿主负责。这里仅保留官方 worker 需要的帧协议、游戏日志观察和 OpenTTD Admin 协议；不链接旧 Rust Server 或 AgentCore。

- `crates/eden-agent-connector-protocol`：worker 帧和消息结构。
- `crates/eden-agent-hoi4`、`eden-agent-victoria3`：已有日志观察与控制桥接。
- `crates/eden-agent-openttd`：从旧 connectors crate 提取的独立 Admin 客户端。
- 可执行入口仍位于 `Connectors/official/*/worker`，根 Cargo workspace 只组装这些辅助组件。

源码从归档保留迁出，历史内联单元测试随源码保留；未编写或运行新测试。worker 的旧 `tests/package_protocol.rs` 仍保留，但因其依赖已归档宿主，暂设 `autotests = false`；T 阶段必须迁移到 TS 宿主契约后恢复覆盖，不能将其计为通过。

发行流程（只提供入口，本阶段不执行）：

1. `npm run build:connectors` 构建当前平台 worker。
2. `npm run package:connectors` 将 worker、manifest 和包资源组装到 `dist/connectors/<id>`，不写入 `Data`。
3. `npm run build:server` 生成宿主 bundle。
4. 使用固定 Node 22.23.1 执行 `node Script/Project/package_server.mjs`，将四个包随宿主放入发行目录；缺少 worker 或校验和不符时拒绝生成制品。

发布 worker 可分别使用 `cargo build --release -p eden-agent-connector-<id>` 和 `node Script/Project/package_connector.mjs <id> --profile release`。Cargo.lock 尚未随新 workspace 解析更新；当前不运行 Cargo，锁文件更新和实际构建留待用户允许验证阶段处理。

打包能力不代表运行平台支持已经完成：当前连接器隔离启动仍仅实现 Linux，网络连接器的受限网络和凭据注入另行实现。权限绑定 manifest、worker 摘要及实例配置版本，升级后需重新授权。
