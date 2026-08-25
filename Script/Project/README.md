# Project development scripts

- `dev.mjs`：分别启动伊甸园 Server（默认 `40092`）与尘世 Server（默认 `40093`），再启动 Web 与 Electron；两个服务使用独立令牌、SQLite、Blob、日志、插件、用户技能、子智能体和连接器目录。若对应端口已有世界身份匹配的健康 Server，则只复用该服务。
- `dev_desktop.mjs`：仅启动 Web 与桌面壳。
- `monconfig.mjs`：读取项目 `.monconfig`。
- `monconfig.test.mjs`：配置读取测试。
- `openttd_launcher.mjs`：OpenTTD 实例配置、端口、注册表和身份匹配清理辅助程序；管理密码只从标准输入读取。Linux 注册表同时固化 PID、`/proc` 启动时钟、实际可执行文件和启动目标，拒绝 PID 重用或目标变化。
- `openttd_launcher.test.mjs`：跨平台验证配置隔离和临时端口；在 Linux 上真实启动伪 OpenTTD 进程，覆盖默认/显式加入后的退出清理、专用服保存退出、身份匹配、共享内容目录及旧运行目录单次迁移。
- `package_connector.mjs`：把已经构建的官方 Connector Worker 与清单、资产组装为完整校验包，并原子安装到 `Data/connectors/packages`；它不会隐式触发 Cargo 构建。

Server 的编译、运行和检查均由 Cargo 完成；本目录不再包含 Python 启动器或 sidecar 打包脚本。

首次编译可能耗时较长。两个 Server 与 Web 的默认就绪等待时间分别为 300 秒和 60 秒，可通过 `.monconfig` 的 `server.READY_TIMEOUT_MS`、`server.WEB_READY_TIMEOUT_MS`，或环境变量 `EDEN_AGENT_SERVER_READY_TIMEOUT_MS`、`EDEN_AGENT_WEB_READY_TIMEOUT_MS` 调整。旧 `Data/eden-agent.db` 与资源目录仅在新分域目录不存在时复制，原始数据不会被移动或删除。
