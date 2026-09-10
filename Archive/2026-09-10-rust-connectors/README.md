# Rust 连接器归档

2026-09-10 连接器统一迁移时归档。`Native/`、四个 worker、Cargo workspace/锁文件均以归档时的内容保存，逐文件 SHA-256 见 `source-sha256.json`。`package/` 的旧清单和资产取自迁移前 Git HEAD，保留历史 native_worker 描述。此目录不属于活动构建，TS 宿主禁止引用它。

当前实现位于 `Server/connectors/official/*/src`，统一 SDK 位于 `packages/plugin-sdk/src/connector`。旧 Windows Victoria 3 控制注入实现保留在这里；对应 TS/PowerShell 实现位于活动插件，但宿主尚无 Windows 连接器隔离器，实际 OS 执行仍待支持与验收。Linux 当前与此前宿主一样不支持该 Windows 操作，不能将其标记为跨平台控制验收完成。

此归档不涉及 `frontend/desktop/native/win32-pointer-observer`。那是桌面指针观察组件，仍使用独立 Rust 构建，与连接器运行时分开记录。
