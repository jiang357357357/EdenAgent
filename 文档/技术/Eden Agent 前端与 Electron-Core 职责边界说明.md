# Eden Agent 前端与 Electron/Core 职责边界

Eden Agent 使用本地单机链路，不扫描随机端口，也不在连接失败后切换到其他主机。

## 默认地址

| 组件 | 默认地址 | 调用方 |
|---|---|---|
| Vite Web 开发服务 | `http://127.0.0.1:40091` | Electron 开发窗口或浏览器 |
| 伊甸园 Rust Agent Server | `http://127.0.0.1:40092` | React renderer（伊甸园模式） |
| 尘世 Rust Agent Server | `http://127.0.0.1:40093` | React renderer（尘世模式） |
| Mon Core | `http://127.0.0.1:40011` | 仅伊甸园 Rust Agent Server |

端口和 Core 地址可由项目 `.monconfig`、启动脚本及对应环境变量显式覆盖，但渲染进程不得自行发现服务。

## 职责

- React renderer 负责界面、视图状态和用户交互；它只通过生成的 typed JSON-RPC 客户端及 Blob 端点访问 Agent Server。
- Electron 负责桌面窗口生命周期、分别启动和监管两个 `eden-agent-server`、选择工作区、屏幕/摄像头捕获，以及向 renderer 交付当前世界的短期 capability token。Electron 不承载 Agent 业务协议，也不代理普通 RPC。
- 每个 Rust Agent Server 只接受启动时固定的 `runtime_origin`，并各自拥有 SQLite、Blob、模型供应商、权限、作业、技能、插件、连接器和所有外部副作用；数据库带有永久世界标记，错配时故障关闭。
- Mon Core 保存 Mon 业务实体和设备能力。Agent Server 仅使用内存中的 Core credential 与其通信；Core 数据不会成为 AgentCore 的依赖。

正式调用链：

```text
React renderer
  ├─ 伊甸园 WebSocket / Blob ─────> eden-agent-server :40092
  │                                  ├─ in-process Rust API ──> AgentCore crates
  │                                  └─ authenticated HTTP ──> Mon Core :40011
  ├─ 尘世 WebSocket / Blob ───────> eden-agent-server :40093
  │                                  └─ in-process Rust API ──> AgentCore + 本地模型
  └─ narrow preload IPC ─────────> Electron（生命周期、媒体、目录选择、能力令牌）
```

## 失败与安全边界

- 两个 `/rpc` 都必须通过 Origin 与各自的短期 capability token 校验；Blob 与实时语音端点使用所在世界的同一能力边界。
- Electron 只把所请求世界的受管 Server 令牌交给受信 renderer，不写入网页持久存储；前端切换世界时关闭旧 RPC 连接。
- 两个世界不共享数据库、Blob、日志、插件安装、用户技能、连接器状态或模型密钥。用户显式把两边工作区选择为同一目录时，工作区文件本身仍可能重合。
- Core 凭据不得进入前端、事件日志、工具参数日志或 AgentCore 上下文。
- 连接失败应报告对应本机组件未启动、配置错误或端口占用，不进行 UDP 探测、注册表服务发现或公网回退。
