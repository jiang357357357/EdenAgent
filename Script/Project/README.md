# Project Scripts

这里放 MonAgent 项目内部使用的开发与工具脚本，例如本地 dev 编排和 `.monconfig` 读取工具。

- `dev.mjs`: Node.js 开发编排，按顺序启动后端、Web 和桌面壳。
- `dev_desktop.mjs`: Node.js 客户端启动脚本，必要时先启动 Web 前端，再打开桌面壳。
- `dev_server.py`: Python 后端启动脚本。
- `monconfig.mjs`: Node.js `.monconfig` 读取工具。
