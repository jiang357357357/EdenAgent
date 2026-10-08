# 159 — Agent 日志统一与结构化留档

日期：2026-10-03。用户授权实现及真实测试；本轮没有操作真实用户数据库、重启用户服务或提交推送。

## 问题与结果

Agent 原有启动 JSON、业务英文 stderr 和 Node SQLite 警告混用，桌面或 MonPM 通过管道收集时难以阅读。现在统一入口默认生成中文控制台文本，结构化信息另存 JSONL；机器消费者可显式选择 JSON 控制台输出。日志是运行诊断，不代替业务数据库、审批记录或持久事件。

默认文本示例：

```text
[09:08:07.006] [INFO] [Agent/伊甸园] 服务启动 · 初始化账号服务 | 账号=账号标识
[09:08:07.020] [WARN] [Agent/尘世] Node.js 运行提示 | 警告类型=ExperimentalWarning | 当前 Node.js 内置 SQLite 接口带有实验性标记
```

时间按运行主机本地时区显示；JSONL 的 `time` 使用 ISO 时间。即使 stdout/stderr 是管道，默认也不会自动变成 JSON。TTY 自动着色；`FORCE_COLOR=1` 强制着色，`FORCE_COLOR=0` 关闭，设置 `NO_COLOR` 优先关闭。`EDEN_AGENT_LOG_FORMAT=json` 显式启用 JSON 控制台输出。两种格式均将 `debug/info` 写到 stdout、`warn/error` 写到 stderr。

## 模块、输入输出及失败处理

| 模块 | 输入与状态归属 | 输出与异常行为 |
| --- | --- | --- |
| `Server/src/modules/logging/logger.ts` | `logDiagnostic(record, level?)` 接收诊断记录；`configureLogging({ origin, dataRoot, env? })` 管理当前进程日志实例。合法记录 `origin` 优先于实例默认值 | 规范化 `event/level/pid/time/origin`，分别写控制台与 JSONL；未配置时只输出文本，不创建目录。关闭当前实例恢复无落盘默认实例；格式化、记录读取或输出失败不替换业务结果 |
| `format-record.ts` | 已脱敏记录、颜色开关；固定中文事件及启动阶段映射 | 输出单行摘要，只展示账号、路径、端口等指定字段；保留中文业务消息及不同的错误摘要，不把任意对象或堆栈摊到正文 |
| `redaction.ts` | 结构化字段、Error/cause、字符串 | 递归脱敏敏感 key、Bearer/Basic、URL 用户名密码、常见 query 密钥及引号 JSON 密钥；限制长度/深度/条目，处理循环和 bigint，去控制符与双向文本控制字符。保留 `undefined` 供 JSON 省略，不修改输入 |
| `jsonl-sink.ts` | 单进程专属文件、大小与备份数 | 同步追加完整 JSON 行；达到阈值后轮转。创建、追加或轮转失败仅报告一次可见警告，停用该文件输出并保留控制台，不阻断业务 |
| `bootstrap/process-diagnostics.ts` | Node `warning` 及 `uncaughtExceptionMonitor` | Node 22 仅移除名为 `onWarning` 的标准打印器，保留其他 warning 观察者；关闭钩子时还原。SQLite 实验性警告增加中文说明，原始 detail/stack 经脱敏留档；未处理异常只监测，不注册吞异常的处理器 |
| `main.ts`、启动/关闭诊断及业务调用点 | 启动配置、账号启动阶段、关闭信号、18 处业务诊断 | 在运行时及 `node:sqlite` 加载前建立诊断；启动失败正常失败退出。关闭日志为中文 `server.stopping/server.stopped`，仍使用既有超时及 IPC 排空机制 |

`index.ts` 只显式导出。基础包没有反向依赖 Server，日志模块不读取用户数据库或模型凭据文件。

脱敏范围是统一 logger 处理的记录，不保证任意第三方进程或 Node 原生致命输出都经过该路径。`uncaughtExceptionMonitor` 保留 Node 默认退出及原生堆栈输出，不能把这项改动描述为隐藏或吞掉所有致命错误。

## 结构化文件与运行配置

日志目录按以下顺序选择第一个非空配置：

1. `EDEN_AGENT_LOG_DIR`。
2. `MON_LOG_START_DIR` 下的 `Text/MonAgent`。
3. 当前 Server `dataRoot` 下的 `logs`。

文件名为 `agent-mon-<pid>.jsonl` 或 `agent-local-<pid>.jsonl`。默认按 10 MiB 阈值轮转，最多保留 `.1`、`.2`、`.3` 三份备份。以完整记录为单位写入，单条记录不会拆成多个文件；不同世界和 PID 不共用轮转文件。

该策略限制单进程文件组，不清理历史 PID 文件，不能推导出整个日志目录的长期磁盘上限。长期开启服务时，历史目录清理仍由现有运维策略管理。

机器调用方若此前解析 `server.listening` JSON，应设置 `EDEN_AGENT_LOG_FORMAT=json`。Server 另向连接的父进程发送 `eden-agent.ready` IPC，独立制品测试使用该消息等待就绪；桌面链路继续通过健康检查验证服务可用，不依赖默认中文 stdout。关闭继续接受 IPC `shutdown`，确认业务与连接排空后断开 IPC。

## 验证与修正

以下 `node` 均指本轮实际使用的 Node.js **22.23.1**。测试只使用 OS 临时目录、临时数据库及合成账号。

| 验证范围 | 最终结果 |
| --- | --- |
| 日志格式、脱敏、JSONL、轮转及故障降级 | 15 项通过；含引号 JSON 密钥、编码 query、长密码/PEM 截断、控制字符、异常 getter、writer 失败及 `undefined` |
| 业务诊断相关回归 | 19 项通过。首轮 14 通过、5 失败；失败由 companion 测试未建立临时 Mon 账号归属引起，补齐夹具后这 5 项重新执行并通过，没有降低业务断言 |
| 启动、进程警告钩子与工作区恢复 | 8 项通过；覆盖保留其他 warning 监听者、钩子恢复及启动/恢复行为 |
| 独立构建制品日志 | 5 项通过；最终补充关闭事件中文映射并重新构建后完整复跑，耗时约 12.62 秒 |
| Desktop 监管与进程相关测试 | 17 项通过 |
| 合计 | **64 项自动测试通过**；不是全项目全量测试 |

主要命令入口：

```sh
node --import tsx --test Server/tests/unit/logging/format-record.test.ts Server/tests/unit/logging/redaction.test.ts Server/tests/unit/logging/jsonl-sink.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.server.json --noEmit
node Script/Project/build_server.mjs
node --test Script/Project/logging_artifact.test.mjs Script/Project/workspace_artifact.test.mjs
node Script/Architecture/check.mjs
node Script/Project/smoke_desktop_server.mjs
```

Server 类型检查及构建成功；最终架构检查扫描 **885 个源文件，0 错误、20 条非阻断提醒**。根仓库、Server 与 frontend 的 `git diff --check` 均退出 0，仅有 LF→CRLF 提示。

## 临时真实桌面监管联调

独立执行 `Script/Project/smoke_desktop_server.mjs`，由生产桌面监管逻辑启动两个真实 Node Server，验证：

- 默认中文 stdout、SQLite warning 与每世界 JSONL 均实际产生；显式 JSON 模式由独立制品测试验证。
- 本地 Server 重启后，目录包含两个世界合计三个 PID 的日志文件，旧进程文件保留；本地重启不影响 Mon Server。
- 能力 token 持久化，重启仍可连接；测试 token 未进入统一日志。
- 桌面联调通过健康检查确认服务就绪，停止时完成 IPC drain，没有依赖英文或 JSON 默认 stdout；就绪 IPC 消息另由独立制品测试验证。

联调脚本同步修正旧 v2 token 路径夹具；测试中的 `takeOverPort` 使用 no-op，不终止其他占用端口的进程；删除临时资源前确认目标位于 OS 临时目录。

本轮未调用真实模型供应商、未进行可见 Electron/浏览器界面验收，未执行全项目全量测试；未替换在线进程、重启用户服务或提交推送。
