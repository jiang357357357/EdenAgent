# Eden Agent 内置工具命名规范

2026-09-11，当前 TypeScript 宿主工具命名约定。本次修改调用标识，提示词自然语言统一中文另见 `ts-migration/宿主提示词全中文待办.md`。

## 命名规则

1. 内置工具使用小写下划线，优先“动词 + 对象”，不加 `eden_` 项目前缀。例如 `read_file`、`exec_command`、`request_user_input`。
2. 名称应反映实际能力，不为了模仿其他产品而改变行为。例如本项目命令工具是限时命令执行，不因此增加持续终端或 stdin 接口。
3. 多动作管理工具使用 `manage_<对象>`，动作继续通过现有 `action` 参数选择；本次不拆分接口或改变参数。
4. 模型调用名称与中文显示名称属于不同层次。当前部分界面直接展示调用名称，本次不是全站中文标签改造。中文说明列用于理解工具职责。
5. 现有语义明确的名称继续使用，包括 `list_skills`、`spawn_agent`、`send_message`、`set_self_awake_timer` 等，不机械改写所有历史名称。

## 当前基础名称

工作区、附件、用户提问和插件管理入口分别使用 `read_file`、`write_file`、`exec_command`、`read_attachment`、`request_user_input`、`manage_plugins` 与 `manage_connector_plugins`。工具定义位于 `Server/src/modules` 下 workspace、attachments、questions、plugins、plugin-market 模块。

## 来源与名称冲突

当前模型接口采用扁平工具名，不能把展示性的 `模块.动作` 直接当作所有供应商均支持的调用格式。通过工具目录的 source / namespace / version 元数据与 revision 辅助区分来源。

- 动态工具插件继续使用 `plugin_<插件标识片段>_<标识摘要>_<工具名片段>`。
- MCP 工具继续使用 `mcp__<插件>__<组件>__<工具>`；超过长度限制时按现有逻辑截断并加摘要。
- 技能代码工具目前使用声明名称；聚合目录发现重名即报错，不能覆盖内置工具。技能自动命名空间不是本次实现内容。
- 聚合校验位于 `Server/src/modules/subagent-execution/tool-policy.ts`；主会话也执行重名检查。

## 兼容与权限

- 新工具目录及新模型请求仅提供新名称，不同时发布两套定义。
- 数据库升级会一次性更新子智能体策略、自定义角色和任务角色快照中的退役内置名称。运行时不保留名称映射，新提交的 `eden_` 前缀策略名称直接拒绝。
- 老式角色导出脚本及界面策略示例同步使用新名称。
- 权限能力键（如 `command.execute`、`workspace.write`）、工具 revision、审批内容和参数 schema 不因此次命名修改而变化。
- 历史模型请求、工具结果和操作审计保留产生时的原始字符串，只作为记录展示，不参与当前工具解析。外部调用方、自定义技能正文或清单需要使用当前目录名称。

## 验收方式

通过 `tool.list` 核对实际目录不存在 `eden_` 前缀；使用临时数据库验证策略升级、去重和角色快照迁移。实际工具执行、审批、拒绝、取消、附件与插件流程按各模块验收，模型请求快照用于核对最终发送名称。
