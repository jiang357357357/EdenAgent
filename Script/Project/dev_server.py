from __future__ import annotations

import os
import signal
import shutil
import subprocess
import sys
from pathlib import Path


def load_project_env(root: Path, env: dict[str, str]) -> None:
    path = root / ".env"
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key or key in env:
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        env[key] = value


def python_command(root: Path) -> list[str]:
    explicit = os.environ.get("MON_AGENT_PYTHON") or os.environ.get("PYTHON")
    if explicit:
        return [explicit]

    if os.name == "nt":
        venv_python = root / "Server" / ".venv" / "Scripts" / "python.exe"
    else:
        venv_python = root / "Server" / ".venv" / "bin" / "python"
    if venv_python.exists():
        return [str(venv_python)]

    uv = shutil.which("uv")
    if uv:
        return [uv, "run", "--project", str(root / "Server"), "python"]

    return [sys.executable]


def main() -> int:
    root = Path.cwd()
    python = python_command(root)
    env = os.environ.copy()
    load_project_env(root, env)
    paths = [root / "Server" / "src", root / "AgentCore" / "src"]
    existing = env.get("PYTHONPATH")
    env["PYTHONPATH"] = os.pathsep.join([*(str(path) for path in paths), *([existing] if existing else [])])
    child = subprocess.Popen(
        [*python, "-m", "mon_agent_server"],
        cwd=root,
        env=env,
        start_new_session=os.name != "nt",
    )
    try:
        return child.wait()
    except KeyboardInterrupt:
        child.send_signal(signal.SIGINT)
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
