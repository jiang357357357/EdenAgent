# MonOs 统一自醒提交协议

2026-09-10，用户明确要求不再兼容旧请求，完成修复并验证 OS 重启自醒。

## 修改

- BaseOs/src/scheduled.rs 统一发送 schema_version、user_id、event_id、idempotency_key、context 五个字段，删除发送端生成的 job_id、assistant_id、character。
- TS Server 保持严格请求校验，不增加旧字段兼容。作业与角色分别由 Agent 创建、从受信 Core 查询。
- BaseOs 新增协议说明 docs/self-awake-agent-contract.md；TS 新增拒绝旧字段和错误用户的回归测试。

## 发布到本机与验证

- `cargo test scheduled::tests --release`：2 项通过。
- `cargo build --release`：成功。
- TS 请求契约专项测试 1 项通过，Server 类型检查通过。
- 备份 LINUX/runtime/os/monos-rust 为 monos-rust.before-awake-contract-20260910-194639，原子替换为新发布版，通过 MonPM 重启 os。
- 真实启动自醒成功：外部提交入库 1 条，执行状态 completed，last_error 为空，日记入库 1 条；MonOs 已轮询到 completed。
- 本轮决策 action 为 chat_user；此记录只确认自醒完成及日记落库，不把决策字段当作通知实际送达证明。
- 下一次 MonOs 计划为当天 22:46:58；Agent 同时存在 22:46:53 的 queued 定时任务。这里只验证本次启动自醒，后续双调度去重尚未验收。

改动尚未提交 Git；仅替换当前本机 OS 制品，未发布到远程仓库或发行渠道。
