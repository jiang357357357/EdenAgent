# MonOs 自醒身份与外部计划

2026-09-10，用户要求继续排查没有自醒记录和下次醒来时间的问题。

## 实际断点

- 当前 TS Server 未配置 Mon 服务身份，真实 `/internal/self-awake/status` 返回 HTTP 503 `Self-awake service identity unavailable`。
- 正在运行的 LINUX MonOs 已启用自醒，计划时间为 2026-09-10 19:41:53 +08:00。Agent 数据库没有作业不等于 MonOs 没有计划。
- 源码工作区与 LINUX 安装的服务身份分别属于用户 1 和用户 2，不能通过搜索最近配置自动选择身份。

## 实现

Mon realm 数据根下支持私有 `mon-service.json`，明确指定 `authFile`、`coreBaseUrl`、可选 `scheduleStateFile`，路径必须绝对。身份文件仅提取共享密钥和用户 ID，不将其他变量传入服务；local realm 不读取该配置。显式环境身份作为整体覆盖，不混用文件字段或其他账户的调度文件。

本机 `Data/realms/mon/v2/mon-service.json` 已指向 LINUX 安装的身份文件与 MonOs 状态文件。该配置被 Data 忽略规则排除，不复制密钥到仓库。

自醒列表读取明确配置的 MonOs 状态文件，与内部 queued 作业比较，展示较早的计划时间。仅只读，不修改外部计划；读失败给出可定位的中文错误。没有计划时前端显示“尚未安排”。

MonOs 只轮询 pending/running，增加桥接状态映射，避免将 queued/preparing 或动作执行阶段误认为已结束。

## 验证与边界

- 身份配置、外部计划、双世界列表和桥接状态共 5 项专项测试通过；测试使用内存数据库/临时目录。
- 前后端类型检查通过。
- 真实 Core 接受 LINUX 服务身份，当前角色接口可读取；不记录令牌，不触发模型生成。
- 使用同一身份对临时 TS Server 的状态接口做签名请求，临时作业设为次日到期，验证后关闭并移除临时数据。
- 未提前触发真实自醒、未修改真实数据库与 MonOs 调度状态。19:41 的实际完整自醒尚待自然执行验收。
- 当前运行的开发 Server 需重启加载新增配置。此配置读取同机 MonOs 文件，不代表远程调度 API 已实现。
