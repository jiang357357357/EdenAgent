---
name: codex-code-skill-smoke
description: 生成并输出一行 JSON 技能报告，用于验证技能包脚本、参考文档和模板资源的完整链路。
metadata:
  monagent:
    display_name: Codex 技能冒烟测试
    version: 1.0.0
    tools:
    - bash
    profiles:
    - user_chat
---

# codex-code-skill-smoke

输出一行 JSON 报告，验证技能包的脚本、参考文档与模板资源链路是否完整。

## 何时读取 references/format.md

- 需要理解或校验输出 JSON 的字段含义（greeting / source）时读取。
- 报告字段定义变化或需要向他人说明输出格式时读取。

## 何时运行 scripts/report.py

- 用户要求生成技能报告、进行冒烟测试或验证本技能时运行。
- 运行方式：`python3 scripts/report.py <姓名>`，姓名参数必填。
- 脚本会读取 assets/greeting.txt 模板，把 `{name}` 替换为传入姓名，输出一行 JSON。
- 按实际输出如实汇报结果；若脚本失败，先修正再重跑，不要伪造输出。
