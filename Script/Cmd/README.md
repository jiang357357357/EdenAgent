# Cmd Scripts

这里放面向命令行或服务启动器调用的前台入口脚本。

- `Win`: Windows PowerShell entry scripts.
- `Linux`: Linux shell entry scripts.

入口拆分：

- `StartServer`: 只启动 Python 后端，优先使用 `Server/.venv` 或 `uv run`。
- `StartDesktop`: 启动客户端，先启动 Web 前端，再打开桌面壳。
- `StartAll`: 开发期一键启动 Server/Web/Desktop。
