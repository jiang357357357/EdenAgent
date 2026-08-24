# MonAgent 可安装连接器协议与包格式

## 决策

长期连接器采用独立子进程，不加载 Rust 动态库。Server 负责包安装、信任、权限、
进程监管、事件持久化和智能体工具；Worker 只负责对接外部系统。

官方连接器与第三方连接器使用完全相同的 Package 和 Worker Protocol。完成迁移后，
`mon-agent-connectors` 不再按 connector key 硬编码游戏或服务实现。

## 进程边界

```text
mon-agent-server
  -> connector package registry
  -> worker supervisor
  -> framed JSON RPC over child stdin/stdout
  -> connector worker
  -> game Mod / local file / remote service
```

Worker 的标准输出是协议专用通道，诊断日志只能写标准错误。协议帧采用四字节网络序
长度前缀加 UTF-8 JSON，单帧上限 8 MiB；这避免换行日志、长 JSON 和二进制转义破坏
消息边界。

## Protocol v1

Host 请求：

- `initialize`：协商协议、传入实例、设置、已批准权限和独立数据目录。
- `health`：读取 Worker 自检。
- `query`：执行 manifest 声明的只读查询。
- `execute`：执行 manifest 声明的有副作用动作。
- `disconnect`：断开外部系统但保持进程可控。
- `shutdown`：有序退出。

Worker 通知：

- `event.publish`：发布带稳定 external ID 的事实事件。
- `worker.status`：报告 connecting、ready、degraded 等状态。
- `worker.log`：可选结构化诊断；不得包含密钥。

请求和响应使用单调递增的进程内 ID。动作还携带持久化 operation ID，使 Host 重试时
可以要求 Worker 去重。Worker 无权访问 MonAgent SQLite，也不能指定另一个连接器 ID。

## 包格式 v1

```text
connector-package/
├── connector.json
├── checksums.json
├── signature.json
├── workers/<platform>/connector(.exe)
├── schemas/
├── assets/
└── skill/SKILL.md
```

manifest 声明固定 ID、版本、协议、平台入口、设置 Schema、事件、查询、动作、资源权限
和可选资产。所有路径必须是包内相对路径；绝对路径、`..`、符号链接逃逸和未声明文件
均拒绝安装。

当前加载器已强制校验全部声明文件的 SHA-256，拒绝缺失摘要、额外文件、路径逃逸和
符号链接；开发模式允许显式加载未校验目录。`signature.json` 是发布者签名的保留槽位，
远程市场已经接入统一 Plugin 信任库；只有签名索引、摘要钉扎且包签名受信的 release 才能进入安装预览。包内技能默认禁用，经过用户检查后
才能进入提示上下文。

## 工具表面

迁移后保留稳定工具：

- `list_connectors`
- `describe_connector`
- `query_connector`
- `execute_connector_action`
- `claim_connector_events`

安装新包只改变连接器目录和 manifest 能力，不增加新的 Server 编译期工具。每个调用都
先通过 manifest Schema，再通过权限策略，最后才发送给对应 Worker。

## 迁移顺序

1. 引入 `mon-agent-connector-protocol`、`package` 和 `host`。
2. 将 HOI4 变为第一个独立 Worker。
3. 引入通用 `query_connector`，移除 `query_hoi4` 静态实现。
4. Victoria 3、OpenTTD 和 Lichess 已迁移为官方外部 Worker 包；继续在各目标平台执行发行签名与真实应用联调。
5. 删除所有 connector key 分支和旧清单目录。
6. 完成签名、原子升级、失败回滚和多语言 SDK。

Protocol v1 是新扩展系统的兼容起点；旧的静态连接器 API 不作为兼容对象。

## 已实现状态（2026-08-21）

- `mon-agent-connector-protocol`：8 MiB 上限的长度前缀 JSON、请求/响应/通知类型。
- `mon-agent-connector-package`：目录热发现、严格 manifest、平台入口、完整性和坏包隔离。
- `mon-agent-connector-host`：最小环境启动、握手、能力核验、超时、通知和有序退出。
- `mon-agent-connectors`：只通过包 Worker 运行，负责状态同步、事件持久化和通用查询/动作工具。
- HOI4：已移除 Server 内的静态运行分支，官方 Worker 通过真实子进程协议运行。
- 前端：目录展示动态包能力与设置 Schema，创建连接器时可填写设置 JSON。

开发安装目录为 `Data/connectors/packages/<connector-id>`。目录变化会触发清单刷新和
对应实例重启；单个坏包只进入 catalog errors，不影响其他包。正式远程分发已由统一
Plugin 市场提供发布者签名、摘要钉扎和撤销。Native Worker 启动时使用最小环境并受
revision 级权限准入，但它仍是受信本机代码边界，不能把“独立进程”误称为内核级沙箱；
不受信任的第三方进程应使用缺少 OS 沙箱即故障关闭的 `mcp_stdio`。
