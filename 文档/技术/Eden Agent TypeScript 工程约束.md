# Eden Agent TypeScript 工程约束

状态：用户于 2026-09-09 批准，适用于新 TS 宿主和基础包。旧前端新增改动逐步遵循，归档源码不要求追溯拆分。

## 目录与职责

采用少量基础包和按业务分目录的服务端：

```text
Server/src/
  main.ts
  bootstrap/{config,container,shutdown}.ts
  transport/{http,websocket,rpc}/
  modules/{sessions,characters,director,memory,self-awake,jobs,subagents,workspace,voice,mon}/
packages/{api,runtime-pi,store,permissions,plugin-sdk,plugin-host,execution,integrations}/
```

只为已实现能力创建目录或 workspace，不创建空壳服务。公开入口 `index.ts` 只显式导出，无业务逻辑和全量星号转发。

业务模块示例：`sessions/contracts.ts`、`session-service.ts`、`session-repository.ts`、`session-events.ts`、`input/`、`turn/`、`recovery/`、`tests/`。协调服务只连接步骤，不能同时拥有所有 SQL、验证、执行和广播实现。

`packages/store` 只拥有连接、事务、schema 迁移等数据库基础设施；业务查询归对应业务 repository。`plugin-host` 按 drafts、validation、builds、testing、installation、activation、runtime、capabilities 划分生命周期。

## 依赖和状态

- 传输层调用业务用例；业务不导入 transport、bootstrap 或全局容器。
- 业务模块之间通过公开入口调用，不读取对方内部实现。
- pi 运行时包只由 `packages/runtime-pi` 导入，插件公开 API 不泄漏 pi 内部类型。
- 基础包不能反向依赖 Server。禁止循环导入。
- 每个状态域只有明确所有者；禁止逐渐扩张为所有服务共享的 AppState。
- 禁止通过 `utils.ts`、`common.ts`、`manager.ts` 或编号分片转移杂项。辅助函数按用途命名。
- 运行边界输入由 schema 校验，内部接口静态类型化。异常必须说明处理方式，不能吞错继续外部副作用。

## 可执行规模门禁

- 手写生产 TS 文件超过 300 行发出警告，超过 500 行阻止检查通过。
- 函数超过 60 行发出警告；圈复杂度超过 15 阻止检查通过。
- `index.ts` 只允许 import/export 声明，禁止承载运行逻辑。
- 测试按行为独立成文件；测试文件同样有 500 行上限，函数体长度提醒不应用测试用例。
- 生成代码、数据夹具和迁移单独归类。例外必须在机器可读配置中绑定确切文件、理由，禁止通配豁免新源码。
- CI 检查文件规模、复杂度、公开入口、越界导入和循环依赖。

行数只是保护网。拆分必须围绕职责，不为通过检查制造 part1/part2。超过警告线时在阶段记录说明保留理由或拆分任务；例外不能掩盖新业务持续堆积。

## 执行节奏补充（用户最新指示）

先完成全部计划功能实现，再集中逐步测试、修正与最终验收。实现期间不逐改动运行专项/全量测试，不为每个小步骤新增测试；已知问题统一记录，阻止继续实现或提交的问题及时处理。规模、依赖、权限和数据边界继续遵守；本条调整测试时机，不降低最终完成标准。

## 开发与验收

每项任务记录所属模块、输入输出、状态归属及失败行为。每阶段文档包含实施项、实际运行的命令、结果和未完成事项；没有证据不标记完成。

长期开工顺序见 [实施跟踪](Eden%20Agent%20TS%20迁移实施跟踪.md)，目标架构见 [实现方案](Eden%20Agent%20TypeScript%20宿主与%20pi%20实现方案.md)。
