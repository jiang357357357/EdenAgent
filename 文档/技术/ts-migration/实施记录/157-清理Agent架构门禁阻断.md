# 清理 Agent 架构门禁阻断

日期：2026-10-03。范围：Agent Server、TUI、store schema 与相关测试。

## 问题与处理

本轮开始时 `check:architecture` 扫描 834 个 TS 文件，报告 35 个错误：26 个函数复杂度超标、4 个跨业务模块内部导入、1 个跨包内部导入、3 条 TUI 循环依赖、1 个迁移文件超过 500 行。

保持原架构规则、阈值和空例外表，通过职责拆分处理：

- QQ：将私聊会话绑定、状态和审批预览整理、审批后的工作区文件读取拆到 `private-session.ts`、`reply-status.ts`、`workspace-file.ts`；附件和 Mon 类型通过公开入口导入。群与私聊隔离、输入幂等、暂存附件事务、文件审批和联系人归属校验保持原逻辑。
- 启动：统一计算受保护数据目录，组装服务复用同一只读配置；不改变服务注册或执行顺序。
- store：迁移 SQL 按 session、capability、automation、subagent、legacy、channel 六种职责归档，由 `migrations.ts` 明确列出 1–128 的执行顺序。128 条 SQL 的内容和顺序均与本轮拆分前一致，schema 版本仍为 128。迁移仍逐项事务提交，失败回滚。
- TUI：共享视图类型独立到 `screen-state.ts`，解除视图间循环引用；拆分正文投影、颜色输出、行内 Markdown、菜单、账号/会话命令及键盘输入处理。
- 业务：ESP32 身份注入与错误映射、模型目录助手读取、提问答案校验、自醒错误分类、单回合上下文和工作区文件搜索各自拆出明确职责，保留错误传播、持久状态和取消边界。
- 联网与 HTTP：公网地址范围判断、搜索结果整理、HTML 正文提取分离；内部 HTTP 路由使用精确路径集合，自醒签名验证单独整理 nonce 失败分类。
- 测试边界：历史迁移夹具改用 `@eden/store/testing` 公开出口，不再跨包读取内部源码。

## 状态和失败行为

| 模块 | 输入与输出 | 状态归属与失败行为 |
| --- | --- | --- |
| QQ 桥接 | 已认证请求 → 会话入队、回复状态、文件回执 | 原会话/输入/事件表；身份不匹配、越界路径和未获审批时拒绝 |
| 迁移 | 当前 schema 版本 → 顺序升级 | SQLite `user_version` 和迁移记录；当前项失败回滚，不改历史 SQL |
| TUI | 终端按键和服务端事件 → 显示帧、RPC 命令 | 仍由 app/terminal 持有交互状态；提取函数不建立新全局状态 |
| 业务服务 | 原业务参数 → 原返回值/诊断码 | 保留会话、模型、问题的原 repository 与提交顺序 |
| 公网和搜索 | 地址/来源结果 → 可访问判断/规范化结果 | 原拒绝范围、排序、去重和单域上限保持不变 |
| 自醒 HTTP | 服务签名 → 业务调用或错误响应 | nonce 仍由 repository 消费；重放、容量和存储失败均拒绝 |

## 已运行验证

本机 Node.js 为 24.21.0；没有启动真实用户服务、访问真实用户数据库、发布或推送。

1. QQ 与 store 定向测试 36 项通过，包括新增私聊事务/回复/审批 3 项、历史迁移 2 项。
2. 联网与 HTTP 定向测试 12 项通过，包括 IPv4/IPv6 边界、搜索归一化、HTML、精确路由和服务签名/nonce 拒绝。
3. 模型、提问、工作区及日记迁移的定向 20 项分组通过。
4. 扩大后的 38 个文件共 100 项不同测试：首轮 99 项通过；`mon-binding-persistence` 的旧夹具没有登记会话账号，补齐临时账号归属后，该项复跑通过。未放宽生产账号校验。
5. `npm run test:architecture`：6 项通过。首次发现测试把路径分隔符写死为 `/`，改为 `path.join` 的平台路径预期后通过；未修改测试发现实现或架构规则。
6. 公网地址与 HEAD 中原实现进行 1,048,576 个 IPv4 样本差分；搜索结果归一化进行 1,000 组确定性样本差分，结果全部一致。
7. TUI 与重构前临时源码副本对照：242 组文本/行内 Markdown、56 组消息正文、60 组面板、3,000 组完整显示帧全部一致，覆盖宽高、首页/会话、登录阶段、菜单、侧栏、颜色及 Unicode。
8. TUI 命令和键盘回归 20 项通过，覆盖认证优先级、命令分派、审批、草稿、密码、粘贴、Unicode 编辑、菜单及历史。与修正类型标注后的 QQ 私聊 3 项合并复跑，23/23 通过。再与重构前副本进行 1,920 组键盘和 666 组命令分派差分，发现并修正 Ctrl+F1 帮助被提前返回的问题；差分全部一致，补充断言后 20 项 TUI 测试再次全部通过，类型和架构检查也再次通过。
9. 最终 `npm run typecheck:server` 通过；`npm run check:architecture` 扫描 866 个 TS 文件，**0 个错误、20 条非阻断提醒**。Server 与 Agent 根仓库 `git diff --check` 均通过。合计 120 项不同业务回归和 6 项架构/测试发现用例通过。

扩大回归的实际文件列表和命令（Agent 根目录）：

```powershell
$architectureTests = @(
  'Server/tests/integration/mon/qq-private-channel.test.ts',
  'Server/tests/integration/mon/qq-group-agent.test.ts',
  'Server/tests/integration/mon/napcat-runtime.test.ts',
  'Server/tests/integration/mon/napcat-tools.test.ts',
  'Server/tests/unit/qq-channel/napcat-preview.test.ts',
  'packages/store/tests/schema-history.test.ts',
  'packages/store/tests/database.test.ts',
  'packages/store/tests/event-indexes.test.ts',
  'packages/store/tests/tool-name-migration.test.ts',
  'packages/store/tests/self-awake-queue.test.ts',
  'packages/store/tests/remove-intentions-migration.test.ts',
  'packages/store/tests/event-patch.test.ts',
  'Server/tests/unit/web/public-address.test.ts',
  'Server/tests/unit/web/search-results.test.ts',
  'Server/tests/web-tools.test.ts',
  'Server/tests/integration/self-awake/http-authorization.test.ts',
  'Server/tests/unit/accounts/http-routing.test.ts',
  'Server/tests/unit/mon/esp32-command.test.ts',
  'Server/tests/unit/mon/device-tools.test.ts',
  'Server/tests/integration/questions/supplementary-answers.test.ts',
  'Server/tests/integration/workspace/search.test.ts',
  'Server/tests/questions.test.ts',
  'Server/tests/workspace-tools.test.ts',
  'Server/tests/mon-binding.test.ts',
  'Server/tests/model-binding-selection-recovery.test.ts',
  'Server/tests/integration/self-awake/diary-clear.test.ts',
  'Server/tests/mon-binding-persistence.test.ts',
  'Server/tests/mon-actor-selection.test.ts',
  'Server/tests/mon-selection.test.ts',
  'Server/tests/assistant-catalog.test.ts',
  'Server/tests/session-context.test.ts',
  'Server/tests/session-environment.test.ts',
  'Server/tests/permission-grants.test.ts',
  'Server/tests/memory-recall.test.ts',
  'Server/tests/durable-inputs.test.ts',
  'Server/tests/restart-user-input.test.ts',
  'Server/tests/attachment-input.test.ts',
  'Server/tests/integration/accounts/transport.test.ts'
)
node --import tsx --test --test-timeout=20000 --test-force-exit @architectureTests
node --import tsx --test --test-timeout=20000 --test-force-exit Server/tests/mon-binding-persistence.test.ts
npm run test:architecture
node --import tsx --test --test-timeout=20000 --test-force-exit Server/tests/integration/mon/qq-private-channel.test.ts Server/tests/unit/tui/terminal-input.test.ts Server/tests/unit/tui/app-commands.test.ts
node --import tsx --test --test-timeout=20000 Server/tests/unit/tui/terminal-input.test.ts Server/tests/unit/tui/app-commands.test.ts
npm run typecheck:server
npm run check:architecture
```

其余首轮旧夹具修正：日记升级测试按真实历史迁移位置构建旧库，不再假定日记迁移就是最新版本；`mon-binding` 的临时会话同样补齐账号归属。真实用户数据未参与测试。

## 规模提醒与验证边界

`createServices` 仍是依赖注入组装入口；`session-service.ts` 保留会话执行生命周期；`web/service.ts` 保留搜索供应商编排；公网单次请求函数保留网络资源的统一收尾。TUI app/terminal 保留交互状态与生命周期。这些文件/函数中的非阻断长度提醒暂保留，后续新增职责应继续拆分，而非追加到协调器。

本轮没有进行完整 CI、Linux/Node 22 环境或真实终端/QQ 联调。代码审阅还发现私聊状态原有的边界：最新 assistant 消息为空时可能遮住之前非空正文；本轮保持原回复选择逻辑，没有将这一独立行为调整混入架构重构。

本轮 35 项架构阻断已清除；20 条非阻断提醒不影响该门禁退出码。检查结果仅代表本地已执行的项目，不能替代未运行的完整 CI 或线上验证。
