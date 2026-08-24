# Eden Agent 真实外部验收手册

状态：等待外部环境  
日期：2026-08-20  
用途：闭合全 Rust 迁移中不能由假服务证明的邮件、QQ 和 OpenTTD 实际投递/进程验收。这里的命令默认不会发送消息；真实发送测试必须同时具备目标配置、Core 凭据和醒目的二次确认值。

## 1. 安全约束

1. 不把 Core token、SMTP 密码、QQ 号或 Admin Port 密码写入仓库、文档、命令输出和验收报告。
2. 邮件和 QQ 测试各只发送一条带唯一 `request_id` 的验收消息。
3. 必须先人工核对收件地址或 QQ 目标；QQ 目标还必须在 Core 中批准，Bot 必须在线。
4. 只有当前 PowerShell 进程中的 `MON_TEST_ALLOW_EXTERNAL_SEND` 精确等于 `I_UNDERSTAND_THIS_SENDS_A_REAL_MESSAGE` 时，真实发送测试才会继续。
5. OpenTTD Admin Port 只允许环回地址；不得为了验收把未加密的 Admin Port 暴露到局域网或公网。
6. 日常开发继续使用增量测试；本手册不授权完整或 release 构建。

## 2. 邮件真实投递

前置条件：

- `GET /api/agent/external-email/status/` 返回 `enabled=true`、`ready=true`、`password_set=true`。
- 收件地址由用户核对，且允许接收一封标题为“Eden Agent 全 Rust 迁移验收”的邮件。
- 已在当前进程中设置 `MON_TEST_CORE_BASE_URL`、`MON_TEST_CORE_TOKEN` 和 `MON_TEST_EMAIL_TO`。

显式启用并运行：

```powershell
$env:MON_TEST_ALLOW_EXTERNAL_SEND = 'I_UNDERSTAND_THIS_SENDS_A_REAL_MESSAGE'
cargo test -p eden-agent-host core_tools::tests::real_core_email_delivery_is_confirmed_by_the_transport -- --ignored --exact --nocapture
Remove-Item Env:MON_TEST_ALLOW_EXTERNAL_SEND
```

通过条件：Core/SMTP 返回成功、`request_id` 原样返回、`rejected` 为空，并由收件方确认收到唯一测试邮件。HTTP 2xx 但存在被拒收地址不算通过。

## 3. QQ 真实投递

前置条件：

- `qq_bot_list` 至少返回一个当前用户拥有且在线的 Bot。
- `qq_bot_targets` 中存在已批准目标。
- 已设置 `MON_TEST_QQ_BOT_ID`、`MON_TEST_QQ_TARGET_TYPE=user|group`、`MON_TEST_QQ_TARGET`。
- 已设置当前进程专用的 `MON_TEST_CORE_BASE_URL` 和 `MON_TEST_CORE_TOKEN`。

显式启用并运行：

```powershell
$env:MON_TEST_ALLOW_EXTERNAL_SEND = 'I_UNDERSTAND_THIS_SENDS_A_REAL_MESSAGE'
cargo test -p eden-agent-host core_tools::tests::real_core_qq_delivery_requires_a_confirmed_bot_ack -- --ignored --exact --nocapture
Remove-Item Env:MON_TEST_ALLOW_EXTERNAL_SEND
```

通过条件：Core 再次验证 Bot 所有权、在线状态和目标准入规则，BotCore/NapCat 返回与本次 `request_id` 对应的成功回执，且 `delivery.confirmed=true`。仅 `queued=true` 不算通过。

## 4. OpenTTD Linux 验收

前置条件：Linux、Node.js 22+、OpenTTD 可执行文件、基础配置、测试存档、环回 Admin Port 密码，以及安装到 OpenTTD `game` 内容目录的 Eden AgentBridge GameScript。

按顺序执行：

```bash
node --test Script/Project/openttd_launcher.test.mjs
MON_OPENTTD_BIN=/absolute/path/to/openttd \
MON_OPENTTD_CONFIG=/absolute/path/to/openttd.cfg \
MON_OPENTTD_SAVE=/absolute/path/to/acceptance.sav \
MON_CONNECTOR_OPENTTD_RIOU='process-only-secret' \
Script/Cmd/Linux/StartOpenTTD.sh --dedicated
```

启动器测试在 Linux 应为 9 项全部通过，不得出现平台跳过；启动时会把仓库中的 GameScript/AI 受管文件幂等安装到持久内容目录。真实实例验收还必须通过 Agent Server 完成以下闭环：

1. connector 读取 `active-instance.json`，校验 PID、`/proc` 启动时钟、实际可执行文件和启动目标。
2. Admin Port 完成密码认证与协议更新频率协商。
3. `query_openttd/get_state` 返回真实 server/company/economy 状态。
4. GameScript 返回至少一个 `openttd.gamescript` 事件，并能对结构化请求返回匹配的 request ID。
5. 在独立验收存档中执行 pause/resume/save；有测试公司时再执行一条可回查的 gameplay command。
6. 正常退出后保存存档，移除匹配的运行注册表和临时实例配置；不得停止身份不匹配的进程。

## 5. Server 恢复

如果为了 Cargo 测试暂停了由 `monpm` 管理的开发 Server，测试结束后必须恢复服务，并重新通过已登录前端或 `model.catalog` 注入仅内存 Core 凭据：

```powershell
& 'D:\Mon\Process\monpm.exe' start agent-api -config 'D:\Mon\.run\monpm\monpm.json'
```

最终记录必须包含测试时间、环境版本、通过/失败、脱敏目标标识、唯一 request ID、外部确认结果，以及 Server 恢复后的 `/healthz`、`/readyz` 和队列指标。不得记录任何秘密。
