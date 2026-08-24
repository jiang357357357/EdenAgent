<div align="center">

# MonAgent Documentation

Design decisions, operations, extension protocols, and acceptance material

[简体中文](README.md) · **English** · [Back to project home](../README.en.md)

</div>

> [!NOTE]
> The project README and this index are maintained in both Chinese and English. Most in-depth design documents currently remain in Chinese; the summaries below help English readers identify the relevant source material.

## Getting started and publishing

| Document | Purpose | Language |
| --- | --- | --- |
| [Suggested learning order](学习/顺序.md) | Recommended path through the source and architecture | Chinese |
| [GitHub publishing checklist](PUBLISHING.md) | Credential, license, asset, and test checks before a public release | Chinese |
| [Rust operations and recovery runbook](技术/MonAgent%20Rust%20运行与故障恢复手册.md) | Build, startup, health checks, and failure recovery | Chinese |

## Architecture and boundaries

| Document | Purpose | Language |
| --- | --- | --- |
| [Long-term all-Rust server architecture](技术/MonAgent%20全%20Rust%20服务端长期架构方案.md) | Structure and dependency direction of the single-process Rust Server | Chinese |
| [All-Rust migration record](技术/MonAgent%20全%20Rust%20迁移执行清单.md) | Historical switch from the Python host/sidecar to Rust | Chinese |
| [Complete capability migration plan](技术/MonAgent%20全%20Rust%20完整功能迁移计划.md) | Product-capability migration status and external prerequisites | Chinese |
| [`mon-agent-app` module boundary](技术/MonAgent%20mon-agent-app%20运行时模块边界.md) | Session runtime and application orchestration responsibilities | Chinese |
| [`mon-agent-provider` module boundary](技术/MonAgent%20mon-agent-provider%20模块边界与拆分说明.md) | Model-provider adapter responsibilities | Chinese |
| [Frontend and Electron/Core boundary](技术/MonAgent%20前端与%20Electron-Core%20职责边界说明.md) | Responsibilities of the desktop shell, renderer, and Server | Chinese |

## Extensions and connectors

| Document | Purpose | Language |
| --- | --- | --- |
| [Unified plugin system](技术/MonAgent%20统一插件系统.md) | Unified model for plugins, skills, workers, MCP, and permissions | Chinese |
| [Installable connector protocol and package format](技术/MonAgent%20可安装连接器协议与包格式.md) | Connector packages, worker protocol, and trust model | Chinese |
| [Hearts of Iron IV observer connector](技术/MonAgent%20Hearts%20of%20Iron%20IV%20观察连接器.md) | Read-only HOI4 log-observation path | Chinese |
| [Victoria 3 observer mode](技术/MonAgent%20Victoria%203%20观察模式.md) | Victoria 3 snapshots, probes, and permission boundaries | Chinese |

## Acceptance and utilities

| Document | Purpose | Language |
| --- | --- | --- |
| [Archived-behavior acceptance matrix](技术/MonAgent%20归档行为验收矩阵.md) | Maps legacy behavior to coverage in the Rust architecture | Chinese |
| [Real external acceptance runbook](技术/MonAgent%20真实外部验收手册.md) | Safe acceptance steps that require real external services | Chinese |
| [Background-removal pipeline](技术/去背景流程_先远程裁剪再绿转透明.md) | Processing order for transparent character art | Chinese |

## Maintenance rules

- Add every new document to both the Chinese and English indexes.
- Use titles that identify the decision or subsystem; avoid time-sensitive labels such as “final version.”
- Procedures with real external side effects must state permissions, safety prerequisites, and rollback behavior.
- Never place API keys, tokens, passwords, or personal paths in documentation, examples, or screenshots.
