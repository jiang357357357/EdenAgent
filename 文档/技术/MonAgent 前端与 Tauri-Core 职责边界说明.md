# MonAgent 前端与 Tauri-Core 职责边界说明

## 目的

这份文档用于固定 MonAgent 桌面端的职责边界，避免后续把 WebView、Tauri、MonHub、MonCore 的责任再次混淆。

## 一句话原则

- `frontend/web` 负责界面、交互、状态展示
- `frontend/desktop/src-tauri` 负责桌面能力、本地协议桥接、后端访问
- `Backend/Server (MonCore)` 负责认证与业务 API
- `Backend/Hub (MonHub)` 负责服务注册、服务发现、消息路由

## 必须遵守的边界

### 1. WebView 不直接承担本地发现职责

`frontend/web` 运行在 WebView 中，本质上仍然是浏览器环境。

因此它不应该直接承担这些职责：

- UDP discovery
- ZeroMQ 连接
- MonHub Protocol 原生发现
- 本地文件系统读取 `.monconfig`

这些能力都应由 Tauri 原生层承接。

### 2. 桌面版对后端的关键访问应优先走 Tauri

对于桌面形态，以下能力应优先通过 Tauri command 暴露给前端：

- Core 登录
- Token 验证
- 退出登录
- 本地服务发现
- MonHub 连接与协议桥接

也就是说，桌面版目标链路应是：

`React(WebView) -> Tauri command -> Core / Hub`

而不是：

`React(WebView) -> 直接猜端口 -> Core / Hub`

### 3. MonHub 的正式发现机制不是 HTTP `/services`

MonHub 当前正式机制是：

- UDP 用于发现 Hub
- `SERVICE_DISCOVER`
- `SERVICE_QUERY`
- `SERVICE_LIST`
- watcher / watch_timeout 等待服务上线通知

因此：

- `/metrics`
- `/services`
- `/discover`

这些 HTTP 端点可以用于调试、观测、辅助排查，但**不应被默认视为桌面前端的正式发现主链路**。

## 当前统一结果

### 已统一

当前桌面登录认证已经开始收口到 Tauri：

- `core_login`
- `core_verify_token`
- `core_logout`

这些 command 由 `frontend/desktop/src-tauri/src/main.rs` 实现，再由 Tauri 请求 MonCore。

### 仍在后续统一范围内

以下能力还需要继续从 WebView 下沉到 Tauri：

- MonHub 正式 discovery
- MonHub `SERVICE_QUERY`
- MonCore 地址解析统一收口
- 需要本地协议能力的其他桌面服务访问

## 对后续开发的硬规则

后续如果有人要新增桌面端后端访问，请先判断：

### 应该放在 WebView 的情况

- 纯 UI 状态
- 纯前端渲染逻辑
- 与桌面能力无关的本地临时状态

### 应该放在 Tauri 的情况

- 需要本地网络能力
- 需要读取本地配置
- 需要 UDP / ZeroMQ / 原生 socket
- 需要统一桌面访问路径
- 需要屏蔽后端地址与发现细节

## 当前结论

MonAgent 桌面版的正确方向不是“让 WebView 直接理解 MonHub”，而是：

- 让 Tauri 成为桌面能力与后端能力的统一入口
- 让 WebView 只消费稳定的 command 接口

后续如需继续统一，请在 Tauri 层继续扩展，不要再把 Hub / Core 发现细节重新泄漏回 `frontend/web`。
