# Cmd Scripts

这里放面向命令行或服务启动器调用的前台入口脚本。

- `Win`: Windows PowerShell entry scripts.
- `Linux`: Linux shell entry scripts.

入口拆分：

- `StartServer`: 只启动 Python 后端，不依赖 Bun。
- `StartWeb`: 只启动 Web 前端，依赖 Node.js/npm/Vite。
- `StartDesktop`: 只启动桌面壳，要求 Web 已可访问。
- `StartAll`: 开发期一键启动 Server/Web/Desktop。
