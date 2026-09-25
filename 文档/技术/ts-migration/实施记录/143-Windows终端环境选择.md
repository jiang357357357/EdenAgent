# 143 Windows 终端环境选择

日期：2026-09-25

## 目标

Windows 上允许选择本机 PowerShell 或已安装的 WSL 发行版。设备默认供伊甸园与尘世共用，当前会话可覆盖或重新跟随设备默认。WSL 是另一种本机终端环境，不恢复暂停的执行沙箱。

## 实现

- `packages/api/src/terminal-environment.ts` 与 `command.terminal.get/set` 定义设备目标、会话目标和可用发行版协议。旧 `command.execution` 的 host/sandbox 兼容字段维持现状。
- `packages/execution/src/wsl-command.ts` 从 Windows 的 `wsl.exe --list --quiet` 获取发行版，处理其 UTF-16LE 输出。选中 WSL 时通过 `wsl.exe --distribution ... --exec /bin/sh` 执行；将 Windows 工作区路径用该发行版的 `wslpath` 转换，命令经标准输入交给 Linux shell。发行版不可用或路径转换失败时报告错误，不切回 PowerShell。
- `CommandService` 从设备设置文件读取默认目标，将当前会话覆盖写入对应世界的 `runtime_settings`。桌面监管的两个 Server 使用同一个 `userData/terminal-settings.json`；独立开发 Server 默认使用仓库的 `Data/terminal-settings.json`，亦可通过 `EDEN_AGENT_TERMINAL_SETTINGS_PATH` 指定共享路径。会话删除时清除覆盖。
- `exec_command` 的审批快照包含当次终端目标；审批后目标改变则拒绝旧请求重新执行。权限模式、其他本机进程入口以及沙箱暂停策略不变。
- 聊天权限菜单增加设备默认与当前会话两个选择框；非 Windows 显示本机 `/bin/sh`。WSL 不可用时保留原选择以供用户识别，并要求重新选择可用终端。

## 检查与待验收

- `npm run typecheck`：Server 与 Web 均通过；`npm run build:server` 已生成 Server 制品。
- 根据当前业务阶段要求，本轮未运行自动化或 UI 测试，也未在 Windows 实机启动 WSL。需在 Windows 上验收发行版枚举、含空格的工作区路径、PowerShell/WSL 切换、两个世界共享设备默认、会话覆盖、取消命令后的进程状态。WSL 工作区挂载配置不支持目标路径时应明确报错。
- 当前 WSL 命令仍受宿主 30 秒超时和取消处理；Windows 进程树结束后 Linux 子进程是否全部收尾，需实机核对，不能以类型检查视为通过。
