# Linux command entrypoints

- `StartServer.sh`：通过 Cargo 前台启动 Rust Server。
- `StartDesktop.sh`：启动 Web 后打开 Electron。
- `StartAll.sh`：启动完整开发环境。
- `StartOpenTTD.sh`：启动本地 OpenTTD 集成环境。默认加入已受管实例，否则创建图形主机；`--dedicated` 创建专用服务器并在本地客户端退出后保存、停止和清理；`--replace` 仅替换 PID、启动时钟、实际可执行文件和启动目标全部匹配的受管实例。Admin Port 强制回环地址，密码通过标准输入传给配置辅助程序。内容、存档和下载保存在 XDG OpenTTD 目录，临时配置与注册表按实例身份清理。
- `start.sh`：`StartAll.sh` 的短入口。
