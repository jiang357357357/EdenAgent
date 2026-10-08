# Windows 控制台日志乱码

日期：2026-10-06。模块：Server 统一日志输出。

## 原因与修复

当前现场是 VS Code Windows PowerShell 终端中的 `npm run dev`，开发宿主 PID 26236 直接继承终端启动两个 Server；不是用户查看日志文件时简单选错编码。

统一 logger 原来不区分终端与重定向，使用 `fs.writeSync` 将 UTF-8 Buffer 写入 stdout/stderr。Windows 控制台代码页为 936 时，会将字节解释成另一种编码；因此 `Agent/伊甸园` 变成 `Agent/浼婄敻鍥璢`，ASCII 的 CoreBridge 请求日志不受影响。

Windows 且实际输出流是 TTY 时改为 `process.stdout.write` / `process.stderr.write` 的 Node Unicode 控制台路径。不设置或全局修改用户控制台代码页；非 Windows 以及文件/管道输出保留同步 UTF-8 字节写入及部分写入循环。输出失败继续容错，不替代业务结果；严重级别分流、脱敏、JSONL 与轮转逻辑不变。

该 WARN 原文为“共享资料库 DLC 未安装或配置无效”。本次只修正乱码，没有变更 DLC 配置、恢复语义或屏蔽告警。

## 验证

- 新增 `Server/tests/unit/logging/console-output.test.ts`：独立子进程验证 stdout/stderr 的 Unicode TTY 路径、真实管道 UTF-8/级别分流，以及关闭 stderr 后业务仍继续。TTY 回归通过替换子进程流 writer 观察调用，不把该回归单独当作 Windows 屏幕验收。
- 修复前新增 4 项中 2 项 TTY 用例失败，另外 2 项管道行为通过；修复后日志相关 19 项全部通过。
- 命令：`node --import tsx --test Server/tests/unit/logging/console-output.test.ts Server/tests/unit/logging/format-record.test.ts Server/tests/unit/logging/jsonl-sink.test.ts Server/tests/unit/logging/redaction.test.ts`。
- `npm run typecheck:server`：通过。
- 独立 Windows PTY 执行 `.release/agent-console-encoding-20261006/tty-check.mjs`，要求 stdout/stderr 真正为 TTY，再将该隔离控制台设为代码页 936。原 UTF-8 fd 写入显示与用户相同的乱码；修复后的 logger 两个流正常显示中文。退出前恢复该控制台原代码页，没有控制用户正在使用的 VS Code 终端。现场结果记录于同目录 `tty-verification.json`。
- 构建与测试使用 Node 24.21.0；编译目标继续为 node22，所用 TTY 输出 API 无新增 Node 版本要求。未使用真实用户数据库作为测试夹具，未调用模型或联网业务。

## 本机更新与加载

任务、源码快照、精确构建报告及备份在 `E:\EDEN\.release\agent-console-encoding-20261006`。使用安装版 sourcemap 的 686 个源文件复现旧主程序，SHA-256 一致；候选仅改变 `Server/src/modules/logging/logger.ts`，无新增/移除生产源文件。

- 旧主程序 SHA-256：`6736c5d7d948a7b1f0e4107f1a1859bf3d0d6d0adc7a8807845a1e81b8326a74`。
- 新主程序 SHA-256：`9110a182278059b5ebd7779fbaee76dbbbd15b1a0baa5958dad143c538302925`。
- 备份并替换便携版 Mon 与桌面内置两份 Server main.mjs、map，以及各 runtime-manifest 的 entrySha256，共六个文件。
- VERSION、BUILD-INFO、主包配置、工作区与 MonPM 配置哈希不变；未修改用户数据库、认证或已有日志文件。
- 本机安装证据：`EDEN_win/Data/Diagnostics/Agent-console-encoding-fix.json`。
- 未关闭当前源码桌面或两个开发 Server，需停止后重新运行 `npm run dev` 才加载新模块。便携运行实例同样需在下次重启时加载编译修复；没有为修补抢占端口或中断任务。

未推进版本、提交推送或正式发布。
