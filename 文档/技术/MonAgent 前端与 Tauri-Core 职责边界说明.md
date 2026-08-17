# MonAgent 前端与 Tauri/Core 职责边界

MonAgent 按固定本地单机模式运行，不执行服务发现。

## 固定地址

| 服务 | 地址 | 调用方 |
|---|---|---|
| MonAgent Server | `http://127.0.0.1:40092` | Tauri 与前端开发代理 |
| MonCore | `http://127.0.0.1:40011` | Agent Server |

## 职责

- React/WebView 负责界面、状态展示和用户交互，不扫描端口。
- Tauri 负责桌面生命周期、系统能力和本地代理边界。
- Agent Server 负责会话、技能与 AgentCore 调用，并直接连接固定的 MonCore 地址。
- MonCore 保存业务数据并编排 MonOs 能力。

正式调用链：

```text
React(WebView) -> Tauri / Agent Server :40092 -> MonCore :40011
```

端口应由各模块 `.monconfig` 和 MonPM 工作区配置保持一致。连接失败时应向用户报告本机服务未启动或端口被占用，不应尝试 UDP 探测、注册表查询或自动切换到其他主机。
