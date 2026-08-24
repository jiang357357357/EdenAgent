# Eden Agent Victoria 3 观察模式

## 目标

为本地 Victoria 3 提供结构化观察能力，并用无副作用探针验证外部回程通道。战役观察仍然只读；可选探针会发送固定键盘输入执行 Debug 控制台 `run` 命令，但只写一条 ACK 日志，不改变游戏状态。不注入 DLL、不读写进程内存、不修改存档。

## 边界

- `AgentCore` 保持游戏无关，不依赖 Victoria 3。
- `eden-agent-victoria3` 负责日志路径解析、协议解析、日志跟随、最新快照、命令文件生成、Windows 控制台注入和 ACK 等待。
- `eden-agent-connectors` 负责持久连接器生命周期、事件入库和 `query_victoria3` Agent 工具。
- `Connectors/official/victoria3/package/assets/game-mod` 是随签名连接器包分发的 Victoria 3 1.13.x 本地 Mod 源码。
- Electron 仍只负责捕获 Victoria 3 窗口；控制台输入由隔离的 Rust Connector Worker 执行，Server 只监管协议和权限。

## 数据流

```text
Victoria 3 on_action
  -> scripted effect / debug_log
  -> Documents/Paradox Interactive/Victoria 3/logs/debug.log
  -> eden-agent-victoria3 tailer
  -> Connector event store + latest snapshot
  -> query_victoria3
  -> Agent analysis
```

无副作用回程探针：

```text
Agent / execute_connector_action(probe_control)
  -> connector.write 权限审批
  -> Rust 生成 run/edenagent_<uuid>.txt
  -> 验证并激活 victoria3.exe 窗口
  -> 打开 Debug 控制台并输入 run edenagent_<uuid>
  -> effect 只执行 debug_log ACK
  -> Rust 等待相同 command_id
  -> 删除临时命令文件并返回 acknowledged=true
```

## 协议

日志中可以存在 Jomini 自己的时间和源文件前缀。解析器从 `[EDENAGENT]|` 开始读取：

```text
[EDENAGENT]|1|HELLO|bridge_version=0.1.0|mode=observe
[EDENAGENT]|1|SNAPSHOT|date=1842.03.15|country_id=CHI|country_name=Great Qing|gold_reserves=125000
[EDENAGENT]|1|ACK|command_id=019...|status=success|action=probe_control
```

当前只接受协议版本 `1` 和 `HELLO`、`SNAPSHOT`、`ACK` 三种记录。`ACK` 必须包含非空 `command_id`。快照字段保留为字符串，避免不同语言和游戏版本的 Jomini 数字格式差异。持久快照使用 `country_id + date` 去重，回执使用 `command_id` 去重。

## Mod 行为

Bridge 通过追加子 on-action 接入原版 `on_game_started_after_lobby` 和 `on_monthly_pulse_country`，不覆盖原版 trigger 或 effect：

- 进入战役后输出 HELLO 和首个玩家国家快照。
- 每个游戏月为玩家国家输出一次快照。
- 不为 AI 国家输出快照。
- 不包含任何可改变游戏状态的 action、scripted GUI 或输入入口。

首版字段包括日期、国家 ID/名称、国库、周收入、周支出、GDP、人口、激进派、忠诚派、合法性、威望和恶名。

## 安装

Windows 开发机运行：

```powershell
Script/Cmd/Win/InstallVictoria3Observer.ps1
```

脚本只在 Victoria 3 用户 Mod 目录建立指向仓库源码的目录联接，不修改游戏安装目录。随后在 Paradox Launcher 的 playset 中启用 **Eden Agent Victoria 3 Observer Bridge**，并以 Debug Mode 启动游戏。

在 Eden Agent 连接器页面添加 `Victoria 3 观察器`，身份可使用 `local`，然后启用连接。默认日志位置为：

```text
%USERPROFILE%/Documents/Paradox Interactive/Victoria 3/logs/debug.log
```

可在连接器 settings 中用 `logPath` 覆盖，或在 Server 环境中设置 `MON_VICTORIA3_LOG_PATH`。

## 回程探针配置

连接器页面中的“控制探针”默认关闭。启用后写入以下设置：

```json
{
  "controlEnabled": true
}
```

可选高级设置：

- `commandDirectory`：命令文件目录，默认是 Victoria 3 用户数据目录下的 `run/`。
- `consoleVirtualKey`：控制台快捷键的 Windows Virtual-Key，默认 `192`（OEM 反引号键）。
- `ackTimeoutMs`：等待 ACK 的超时，默认 10000，限制为 1000–30000。
- `focusDelayMs`：聚焦、开关控制台和提交命令后的等待时间，默认 350。
- `keyDelayMs`：输入命令时每个 UTF-16 单元的间隔，默认 8。

执行条件：Windows、Victoria 3 Debug Mode、非 Ironman、观察 Mod 已在加载完成的战役中输出 `HELLO`、游戏存在可见窗口、控制台在执行前处于关闭状态。仅仅发现日志文件或游戏窗口不算就绪。Windows Server 会按进程映像验证窗口属于 `victoria3.exe`，不会仅凭窗口标题发送按键。

探针生成的 effect 只有：

```text
debug_log = "[EDENAGENT]|1|ACK|command_id=<uuid>|status=success|action=probe_control"
```

Rust 不接受模型提供的 PDXScript，也不接受模型指定命令文件名。只有收到匹配 UUID 的 ACK 才报告成功；按键发送成功不等于游戏执行成功。

## 状态语义

- `runtimeState=connecting`：日志文件尚不存在。
- `runtimeState=connected`：Rust 已成功跟随日志文件。
- `attached=true`：日志文件可读。
- `bridgeSeen=true`：至少解析到一条兼容 Bridge 记录。
- `latestSnapshot=null`：尚未进入战役、Mod 未启用或还没有产生快照。
- `latestAck`：最近一次解析到的控制台回执；它不代表 Mod 已启用。

日志可读不等于 Bridge 已加载，因此 Agent 必须同时检查 `bridgeSeen` 和 `latestSnapshot`。

## 尚未实现

当前没有暂停、调速、保存、建设、取消建设、切换生产方式或外交动作。下一阶段只有在回程探针通过 Victoria 3 1.13.10 实机验证后，才研究参考 OGAS 的合法建设队列 effect。所有玩法动作必须使用结构化参数、固定模板、权限审批、命令 ID、ACK 和执行后快照核验；不开放任意控制台命令。

## 版本策略

Bridge 元数据声明支持 Victoria 3 `1.13.*`。游戏升级后先在独立 playset 中完成启动和快照验证，再更新支持范围。未知协议版本由 Rust 解析器忽略，不能降级成猜测解析。
