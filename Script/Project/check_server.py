from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


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


def run(root: Path, python: list[str], env: dict[str, str], args: list[str]) -> int:
    return subprocess.run([*python, *args], cwd=root, env=env).returncode


def main() -> int:
    root = Path.cwd()
    python = python_command(root)
    env = os.environ.copy()
    paths = [root / "Server" / "src"]
    existing = env.get("PYTHONPATH")
    env["PYTHONPATH"] = os.pathsep.join([*(str(path) for path in paths), *([existing] if existing else [])])

    for args in (["-m", "compileall", "-q", "Server/src"], ["-m", "unittest", "discover", "-s", "Server/tests"]):
        code = run(root, python, env, args)
        if code != 0:
            return code
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
