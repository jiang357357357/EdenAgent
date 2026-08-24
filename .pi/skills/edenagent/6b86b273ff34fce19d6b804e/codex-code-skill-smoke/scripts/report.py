#!/usr/bin/env python3
"""输出一行 JSON：greeting 与 source。

用法: python3 scripts/report.py <姓名>
"""
import json
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 2:
        print("用法: python3 scripts/report.py <姓名>", file=sys.stderr)
        return 1

    name = sys.argv[1]
    template_path = Path(__file__).resolve().parent.parent / "assets" / "greeting.txt"
    template = template_path.read_text(encoding="utf-8").strip()
    greeting = template.replace("{name}", name)

    report = {"greeting": greeting, "source": "skill-script"}
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
