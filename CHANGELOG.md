# 更新日志

本文件记录 Eden Agent 聚合仓库的显著变化。

## [Unreleased]

## [1.10.1] - 2026-09-01

### Changed

- 聚合配置与 Rust 工作区元数据同步到 Eden `1.10.1`，并更新 AgentFrontend 稳定发行源码引用。

## [1.10.0] - 2026-09-01

### Changed

- 聚合配置与 Rust 工作区元数据同步到 Eden `1.10.0`，并更新 AgentFrontend 源码引用。

## [1.9.2] - 2026-09-01

### Changed

- 同步 Eden `1.9.2` 产品版本，并接入 Windows x64 AgentFrontend 与 AgentServer 完整分发构建。

### Fixed

- Agent 开发启动器显式声明外部管理的运行域，不再把开发父进程生命周期误当成 `mon` 与 `local` 两个运行域均由外部接管。
- 将不含凭据的模块 `.monconfig` 纳入源码，确保干净工作区具备版本校验、端口和启动脚本所需的配置契约。

## [1.9.1] - 2026-08-29

### Changed

- Linux 服务端启动优先使用完整分发安装的预编译 `eden-agent-server`，仅开发工作区在二进制缺失时回退到 Cargo。
- 移除模块配置中已退出运行链路的 Python AgentServer 环境脚本定义，并同步 Eden `1.9.1` 产品版本。

## [1.9.0] - 2026-08-27

### Changed

- 自 2026-08-24 起，当前版本改用 PolyForm Noncommercial 1.0.0 非商业许可，并提供单独商业授权；历史 MIT 版本的既有授权不追溯撤销。
- 统一 Eden Agent 模块配置边界和启动脚本，并更新 AgentCore、AgentServer 与 AgentFrontend 运行组件。
- `AgentCore` 已由仓库内的 Rust workspace 正式接管，通过原生 sidecar 与 AgentServer 通信；旧 Python 实现不再作为活动子模块参与安装、启动和发布。
- 开发自动登录账号改为仅从 `EDEN_AGENT_DEV_USERNAME` 与 `EDEN_AGENT_DEV_PASSWORD` 注入，不再提交默认口令。
- Agent Server 持久化流式 TTS 音频并在首次合成前同步 Mon Core 会话投影；AgentFrontend 同步修正纯标点流式分段。

## [1.8.0] - 2026-08-05

### Added

- 建立内置技能示例与技能变更检查基线，并收录 AgentFrontend、AgentServer、AgentCore 的 `1.8.0` 源码快照。

### Changed

- 更新聚合配置和三个子仓库引用，统一到新的 Agent 运行时能力。

## [1.7.5] - 2026-08-04

### Changed

- 接入 Mon `1.7.5` 统一产品版本基线。
- AgentFrontend、AgentServer 和 AgentCore 的源码提交纳入完整分发审计。
