# 更新日志

本文件记录 Eden Agent 聚合仓库的显著变化。

## [Unreleased]

### Changed

- 自 2026-08-24 起，当前版本改用 PolyForm Noncommercial 1.0.0 非商业许可，并提供单独商业授权；历史 MIT 版本的既有授权不追溯撤销。
- 统一 Eden Agent 模块配置边界和启动脚本，并更新 AgentCore、AgentServer 与 AgentFrontend 运行组件。
- `AgentCore` 已由仓库内的 Rust workspace 正式接管，通过原生 sidecar 与 AgentServer 通信；旧 Python 实现不再作为活动子模块参与安装、启动和发布。
- 开发自动登录账号改为仅从 `EDEN_AGENT_DEV_USERNAME` 与 `EDEN_AGENT_DEV_PASSWORD` 注入，不再提交默认口令。

## [1.8.0] - 2026-08-05

### Added

- 建立内置技能示例与技能变更检查基线，并收录 AgentFrontend、AgentServer、AgentCore 的 `1.8.0` 源码快照。

### Changed

- 更新聚合配置和三个子仓库引用，统一到新的 Agent 运行时能力。

## [1.7.5] - 2026-08-04

### Changed

- 接入 Mon `1.7.5` 统一产品版本基线。
- AgentFrontend、AgentServer 和 AgentCore 的源码提交纳入完整分发审计。
