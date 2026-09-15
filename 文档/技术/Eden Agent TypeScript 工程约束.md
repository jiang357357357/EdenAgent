# Eden Agent TypeScript 工程约束

状态：用户于 2026-09-09 批准，适用于新 TS 宿主和基础包。旧前端新增改动逐步遵循，归档源码不要求追溯拆分。

## 目录与职责

采用少量基础包和按业务分目录的服务端：

```text
Server/src/
  main.ts
  bootstrap/{config,container,shutdown}.ts
  model-prompts/
  transport/{http,websocket,rpc}/
  modules/{sessions,characters,director,memory,self-awake,jobs,subagents,workspace,voice,mon}/
packages/{api,runtime-pi,store,permissions,plugin-sdk,plugin-host,execution,integrations}/
```

只为已实现能力创建目录或 workspace，不创建空壳服务。公开入口 `index.ts` 只显式导出，无业务逻辑和全量星号转发。

业务模块示例：`sessions/contracts.ts`、`session-service.ts`、`session-repository.ts`、`session-events.ts`、`input/`、`turn/`、`recovery/`、`tests/`。协调服务只连接步骤，不能同时拥有所有 SQL、验证、执行和广播实现。

`packages/store` 只拥有连接、事务、schema 迁移等数据库基础设施；业务查询归对应业务 repository。`plugin-host` 按 drafts、validation、builds、testing、installation、activation、runtime、capabilities 划分生命周期。

宿主自行编写、直接发送给模型的系统规则、任务说明、动态上下文包装和内置工具描述，统一使用中文并集中在 `Server/src/model-prompts/`；`packages/runtime-pi` 自有的压缩、历史交接等提示集中在包内 `src/model-prompts.ts`。业务模块只组装结构化上下文和调用提示函数，不再内联大段模型自然语言。工具名、参数名、协议值和代码示例保持兼容；用户内容、角色人设、第三方插件/技能/MCP 提供的原始说明不强制翻译。旧模板原文只允许作为明确标注的历史兼容匹配常量存在，不得用于构造新请求。

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
- Server 新测试按 `tests/unit`、`tests/integration`、`tests/contracts` 或 `tests/regression` 分层，并继续按业务模块分组；顶层测试文件是待迁移兼容区。默认测试入口必须使用 `Script/Test/run_typescript_tests.mjs` 递归发现 packages 与 Server 测试，禁止恢复只能匹配顶层文件的浅层 glob。
- 生成代码、数据夹具和迁移单独归类。例外必须在机器可读配置中绑定确切文件、理由，禁止通配豁免新源码。
- CI 检查文件规模、复杂度、公开入口、越界导入和循环依赖。

行数只是保护网。拆分必须围绕职责，不为通过检查制造 part1/part2。超过警告线时在阶段记录说明保留理由或拆分任务；例外不能掩盖新业务持续堆积。

## 执行节奏补充（用户最新指示）

先完成全部业务及计划功能实现，再集中编写测试代码；只有用户明确要求后才运行测试、逐步修正与最终验收。实现阶段不逐改动新增测试，不运行专项、全量、冒烟或 UI 测试；不得以提交、阶段完成或“检查”为由变相测试。已知问题记录在案，优先业务覆盖。规模、依赖、权限和数据边界继续遵守；未测试的实现仅记为已实现，最终验收标准不变。

## 开发与验收

每项任务记录所属模块、输入输出、状态归属及失败行为。每阶段文档包含实施项、实际运行的命令、结果和未完成事项；没有证据不标记完成。

长期开工顺序见 [实施跟踪](Eden%20Agent%20TS%20迁移实施跟踪.md)，目标架构见 [实现方案](Eden%20Agent%20TypeScript%20宿主与%20pi%20实现方案.md)。

## 模型接口边界

模型参数表达业务选择，不要求模型照抄内部内容哈希、快照修订号或执行代际。发现与加载使用稳定名称或 ID，由宿主解析当前定义并维护执行和审批快照。模型工具不得直接复用包含管理端并发控制字段的 RPC schema；需要独立定义最小业务参数。插件安装、回滚等明确选择历史制品的操作可以指定版本，但普通调用由宿主选择已激活版本。独立批量加载应逐项报告结果，单项失败不能撤销其他成功项。新增此类内部参数必须先证明模型需要做相应业务选择，并提供针对实际调用行为的测试。

业务工具不得直接修改“已投递”“已触发”等宿主执行事实来替代真实操作；此类状态由实际操作结果驱动。读取/编辑快照按会话、回合和行动角色隔离，不在模型参数之间传递。子任务底层资源计数预算由宿主与角色策略提供，模型接口只保留明确的任务选择。
