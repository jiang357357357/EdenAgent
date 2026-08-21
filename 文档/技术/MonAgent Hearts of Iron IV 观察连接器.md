# MonAgent Hearts of Iron IV 观察连接器

## 结论

Hearts of Iron IV 使用可安装的独立只读连接器。游戏侧 Mod 通过原生 `log`
效果写入 `logs/game.log`；独立 Rust Worker 追踪并解析日志，Rust Server 只负责
监管通用 Worker 协议、持久化事件，并通过 `query_connector` 提供最新战役快照。

该方案不注入游戏进程、不读取内存、不修改存档，也不模拟键鼠输入。

## 数据链路

```text
HOI4 Observer Mod
    -> logs/game.log
    -> mon-agent-connector-hoi4 Worker
    -> Connector Protocol v1
    -> generic Worker supervisor
    -> Connector events / query_connector
    -> Agent runtime
```

## 代码边界

- `Connectors/official/hoi4/package`：可分发清单、平台入口和 HOI4 Mod 资产。
- `Connectors/official/hoi4/worker`：Connector Protocol v1 Worker。
- `Connectors/official/hoi4/protocol.md`：版本化日志协议。
- `Server/crates/mon-agent-hoi4`：仅由官方 Worker 链接的日志解析库；Server 不链接它。
- `Server/crates/mon-agent-connectors`：通用包生命周期、Worker 监管、事件持久化和工具路由。
- `Script/Cmd/Win/InstallHoi4Observer.ps1`：开发 Mod 安装入口。
- `Script/Project/package_connector.mjs`：构建产物的校验和与开发安装入口。

Server 的依赖树中没有 `mon-agent-hoi4`。官方与第三方连接器使用同一种包和进程
协议；增加新连接器不需要给 Server 增加新的 Rust 依赖或工具名称。

## 协议与状态

协议 v1 使用不会触发 HOI4 方括号本地化解析的 ASCII 标记：

```text
MONAGENT_HOI4|1|HELLO|bridge_version=0.1.0|mode=observe
MONAGENT_HOI4|1|SNAPSHOT|date=1939.9.1|country_tag=GER|...
```

当前快照包含国家、日期、政治点数、稳定度、战争支持度、人力、燃油、工厂、
陆海空经验、战争状态和阵营状态。Rust 同时保留原始字符串字段与规范化后的
类型字段，避免游戏版本或本地化格式变化造成不可恢复的数据损失。

启动时只恢复日志中的最后一条 HELLO 和最后一条 SNAPSHOT，避免 Server 重启时
重复发布整段历史。日志缩短或轮转后观察器会清空游标并重新扫描。

## 安装与验证

```powershell
cargo build -p mon-agent-connector-hoi4
node D:\Mon\Agent\Script\Project\package_connector.mjs hoi4 --profile debug
powershell -NoProfile -ExecutionPolicy Bypass -File D:\Mon\Agent\Script\Cmd\Win\InstallHoi4Observer.ps1
```

安装器在 HOI4 用户目录创建开发目录联接和启动器 `.mod` 描述文件，不修改 Steam
游戏目录。随后需要在 Paradox Launcher 的独立 playset 中启用
`MonAgent Hearts of Iron IV Observer Bridge` 并进入一次战役。

实机验收条件：

1. `logs/game.log` 出现 `MONAGENT_HOI4|1|HELLO`。
2. 玩家国家出现一条 `SNAPSHOT`，月度推进后出现下一条快照。
3. `error.log` 不包含 `monagent_hoi4` 相关脚本错误。
4. MonAgent 连接器状态为已连接，`bridgeSeen=true`。
5. `query_connector` 使用 `get_state` 和空 payload 后，返回与当前玩家国家一致的类型化字段。

## 限制

- v1 严格只读，没有暂停、调速、生产、科研、外交或部队命令。
- 本地 Mod 可能影响校验和、多人联机和成就资格，应使用单独 playset。
- 多人模式、观察者国家和多个人类国家的快照聚合尚未进入 v1 范围。
- 支持的 HOI4 脚本版本当前声明为 `1.19.*`；升级游戏后必须重新进行实机验收。
