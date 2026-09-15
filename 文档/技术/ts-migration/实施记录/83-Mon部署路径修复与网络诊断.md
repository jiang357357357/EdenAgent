# Mon 部署路径修复与网络诊断

日期：2026-09-14。

当前 `Data/realms/mon/v2/mon-service.json` 指向已不存在的 `/home/manager/work/Eden/LINUX`，导致读取认证文件时 ENOENT，伊甸园宿主退出。通过监听 40011 的 Core 进程工作目录及 MON_WORKSPACE_ROOT 确认实际部署为 `/home/manager/work/Eden/Eden-Linux/LINUX`；该部署的认证文件与自醒状态文件均存在。配置已更新为显式相对 deploymentRoot，以及该部署内的 authFile/scheduleStateFile，原配置在同目录保留备份。没有复制或替换认证文件。

启动配置现支持相对路径；检查配置格式、文件存在性/可读性和完整服务身份。环境认证整体覆盖文件绑定，部分覆盖会明确报错，不混入其他部署的配置。Mon JSON、服务令牌及音频 fetch 的连接错误现提供底层错误码和目标 origin，取消/超时单独标注，不输出令牌、请求体或查询参数。

6 项专项通过，包括真实连接拒绝的安全诊断、取消、相对部署路径、缺失认证字段以及原有 Mon 请求契约。类型检查和宿主构建通过；架构检查保留原有 model-binding.ts / model-catalog.ts 复杂度错误，无新增错误。

真实验证：服务身份取令牌成功，使用该令牌读取 `/api/assistants/` 成功；返回内容与令牌未输出。重新运行开发环境后，两个宿主启动成功，但 Web 遇到独立的 inotify ENOSPC 错误。随后以 `CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=1000 npm run dev` 启动成功，Mon `/readyz`、Local `/healthz` 及 Web HTTP 均正常，桌面进程已启动。未修改系统级监听限制。

原先界面 `fetch failed` 的历史底层原因无法仅凭旧日志确定；本次验证确认当前配置下认证与 Core 查询正常。日志在 `.artifacts/mon-service-path-fix/`。
