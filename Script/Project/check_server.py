from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def run(root: Path, python: str, env: dict[str, str], args: list[str]) -> int:
    return subprocess.run([python, *args], cwd=root, env=env).returncode


def main() -> int:
    root = Path.cwd()
    python = os.environ.get("MON_AGENT_PYTHON") or os.environ.get("PYTHON") or sys.executable
    env = os.environ.copy()
    paths = [root / "Server" / "src", root / "AgentCore" / "src"]
    existing = env.get("PYTHONPATH")
    env["PYTHONPATH"] = os.pathsep.join([*(str(path) for path in paths), *([existing] if existing else [])])

    for args in (["-m", "compileall", "-q", "Server/src"], ["-m", "unittest", "discover", "-s", "Server/tests"]):
        code = run(root, python, env, args)
        if code != 0:
            return code
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
