<div align="center">

# Eden Agent 文档

设计决策、运行手册、扩展协议与验收资料

**简体中文** · [English](README.en.md) · [返回项目首页](../README.md)

</div>

> [!NOTE]
> README 和本索引提供中英文版本。现有深度技术文档主要以中文维护；英文索引为每份文档提供用途说明，便于非中文读者定位资料。

## 入门与发布

| 文档 | 用途 |
| --- | --- |
| [学习顺序](学习/顺序.md) | 建议的源码与架构阅读路径 |
| [GitHub 发布检查表](PUBLISHING.md) | 公开仓库前的密钥、许可证、资源和测试检查 |
| [Rust 运行与故障恢复手册](技术/Eden Agent%20Rust%20运行与故障恢复手册.md) | 构建、启动、健康检查和故障恢复 |

## 架构与边界

| 文档 | 用途 |
| --- | --- |
| [全 Rust 服务端长期架构方案](技术/Eden Agent%20全%20Rust%20服务端长期架构方案.md) | 单进程 Rust Server 的长期结构与依赖方向 |
| [全 Rust 迁移执行记录](技术/Eden Agent%20全%20Rust%20迁移执行清单.md) | 从 Python host/sidecar 切换到 Rust 的历史记录 |
| [完整功能迁移计划](技术/Eden Agent%20全%20Rust%20完整功能迁移计划.md) | 产品能力迁移状态与外部条件 |
| [`eden-agent-app` 模块边界](技术/Eden Agent%20eden-agent-app%20运行时模块边界.md) | 会话运行时与应用编排层职责 |
| [`eden-agent-provider` 模块边界](技术/Eden Agent%20eden-agent-provider%20模块边界与拆分说明.md) | 模型供应商适配层职责 |
| [前端与 Electron/Core 职责边界](技术/Eden Agent%20前端与%20Electron-Core%20职责边界说明.md) | 桌面壳、渲染进程和 Server 的调用边界 |

## 扩展与连接器

| 文档 | 用途 |
| --- | --- |
| [统一插件系统](技术/Eden Agent%20统一插件系统.md) | Plugin、Skill、Worker、MCP 和权限的统一模型 |
| [可安装连接器协议与包格式](技术/Eden Agent%20可安装连接器协议与包格式.md) | Connector Package、Worker Protocol 与信任模型 |
| [Hearts of Iron IV 观察连接器](技术/Eden Agent%20Hearts%20of%20Iron%20IV%20观察连接器.md) | HOI4 只读日志观察链路 |
| [Victoria 3 观察模式](技术/Eden Agent%20Victoria%203%20观察模式.md) | Victoria 3 快照、探针和权限边界 |

## 验收与工具

| 文档 | 用途 |
| --- | --- |
| [归档行为验收矩阵](技术/Eden Agent%20归档行为验收矩阵.md) | 旧实现行为到 Rust 架构的覆盖映射 |
| [真实外部验收手册](技术/Eden Agent%20真实外部验收手册.md) | 需要真实外部服务时的安全验收步骤 |
| [去背景流程](技术/去背景流程_先远程裁剪再绿转透明.md) | 角色图片透明背景处理顺序 |

## 维护规则

- 新文档应在本索引和英文索引中登记。
- 文件名和标题应清楚表达决策对象，避免使用“最终版”等时效性名称。
- 涉及真实外部副作用的步骤必须写明权限、安全条件和回滚方式。
- 不在文档、示例或截图中提交 API Key、Token、密码及个人路径。
