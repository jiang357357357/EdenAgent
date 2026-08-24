# Eden Agent 前端与 Electron/Core 职责边界

Eden Agent 使用本地单机链路，不扫描随机端口，也不在连接失败后切换到其他主机。

## 默认地址

| 组件 | 默认地址 | 调用方 |
|---|---|---|
| Vite Web 开发服务 | `http://127.0.0.1:40091` | Electron 开发窗口或浏览器 |
| Rust Agent Server | `http://127.0.0.1:40092` | React renderer（WebSocket JSON-RPC 与 Blob HTTP） |
| Mon Core | `http://127.0.0.1:40011` | Rust Agent Server |

端口和 Core 地址可由项目 `.monconfig`、启动脚本及对应环境变量显式覆盖，但渲染进程不得自行发现服务。

## 职责

- React renderer 负责界面、视图状态和用户交互；它只通过生成的 typed JSON-RPC 客户端及 Blob 端点访问 Agent Server。
- Electron 负责桌面窗口生命周期、启动和监管 `eden-agent-server`、选择工作区、屏幕/摄像头捕获，以及向 renderer 交付短期 capability token。Electron 不承载 Agent 业务协议，也不代理普通 RPC。
- Rust Agent Server 是唯一 Agent 后端进程，直接链接 AgentCore crates，拥有 SQLite、模型供应商、权限、作业、技能、连接器和所有外部副作用。
- Mon Core 保存 Mon 业务实体和设备能力。Agent Server 仅使用内存中的 Core credential 与其通信；Core 数据不会成为 AgentCore 的依赖。

正式调用链：

```text
React renderer
  ├─ WebSocket JSON-RPC / Blob ──> eden-agent-server :40092
  │                                  ├─ in-process Rust API ──> AgentCore crates
  │                                  └─ authenticated HTTP ──> Mon Core :40011
  └─ narrow preload IPC ─────────> Electron（生命周期、媒体、目录选择、能力令牌）
```

## 失败与安全边界

- `/rpc` 必须同时通过 Origin 与短期 capability token 校验；Blob 端点使用同一能力边界。
- Electron 只把当前受管 Server 的令牌交给受信 renderer，不写入网页持久存储。
- Core 凭据不得进入前端、事件日志、工具参数日志或 AgentCore 上下文。
- 连接失败应报告对应本机组件未启动、配置错误或端口占用，不进行 UDP 探测、注册表服务发现或公网回退。
