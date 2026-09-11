# Windows 原生构建与真实测试

日期：2026-09-11。用户明确要求编译 Windows 并进行真实测试；仅本地重建，未推进版本或发布。

## 已修复

- Server 连接器网络桥去除 Linux 限制，Windows 使用随机命名管道；固定目标、授权检查、连接数及取消控制仍生效。Windows 不执行 Unix chmod/目录删除。
- execution 的 taskkill 与 worker 自行退出竞争：仅 taskkill 返回 128 且原 PID 已不存在时接受已退出；其他失败继续报错。
- 修复 Windows 测试的数据库关闭顺序、目录 junction 夹具及 PowerShell 工作区命令。
- 前端 npm 启动器按指定平台使用 path.posix/path.win32；根工作区锁定 @electron/packager 20.0.1，根 npm ci 可提供打包工具。
- OpenCode Go 实际调用返回 MissingSessionID；pi 公共模型 headers 接入 Eden User-Agent 和会话 ID 的 SHA-256，工具续轮及重启保持一致、跨会话不同。供应商要求见 https://opencode.ai/docs/go/#where-can-i-use-it。
- Mon 便携启动脚本识别 TS 制品，使用附带 Node，mon 数据与能力令牌独立放入 Data/Agent/realms/mon/v2。

- 拉取远端自醒更新后撤销临时的调度归属改动，按正式设计验证 Agent 的 `set_self_awake_timer` 权限请求、计划发布和 MonOs 到期唤醒。

## 已执行证据

Windows 11 x64 虚拟机 eden-win11-build，Node 22.23.1，pi 0.82.0，Electron 42.4.0。

- 最新源码 `npm run test:all`：769 项，764 通过、0 失败、5 跳过；Windows 类型检查通过；源码架构检查 676 个文件、0 errors，有既有规模警告。
- npm run build:server、package_server.mjs、frontend dist:win 完成；MonOs cargo test 14 通过、2 ignored，cargo build --release --locked 完成。
- Windows 打包服务连接真实 GLM-5.3-Flash：17 项通过，读取随机文件、工具续轮、消息持久化、重启恢复、跨世界数据与令牌隔离。
- 实际 Electron 页面加载及两个世界 RPC 认证 3 项通过，无 pageerror；不代表全部业务页面已验收。
- 自醒真实联调 18 项通过：启动唤醒和一分钟后的定时唤醒均完成，真实模型写入两篇带随机标记的日记；定时权限显式批准，Agent 计划由 MonOs 接收；前端列表、签名、幂等和重放拒绝均通过。测试夹具前两次分别因错误权限枚举及遗漏 `memo.write` 一次性授权失败，修正后完整重跑通过。
- 测试仅使用新建临时 Core/Agent 数据和测试助手，无真实用户数据库夹具或外发联系。

证据目录：工作区 EDEN_win_20260911_bfe6c8a/build-verification；构建执行区 .win-build/rebuild-20260911-bfe6c8a。最终结果见包内 BUILD-INFO.md 与 verification-summary.json。
