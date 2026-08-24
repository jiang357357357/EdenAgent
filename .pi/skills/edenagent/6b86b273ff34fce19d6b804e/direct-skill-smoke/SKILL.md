---
name: direct-skill-smoke
description: 当用户说“直接技能测试”时，运行 git status --short 并简洁汇总当前工作区改动。
metadata:
  edenagent:
    display_name: 直接技能测试
    version: 1.0.0
    tools:
    - bash
    profiles:
    - user_chat
---

当用户说出“直接技能测试”或等价表达时执行以下步骤：

1. 在当前工作区运行 `git status --short`，获取工作区改动列表。
2. 若命令失败（例如不是 Git 仓库），如实报告错误，不编造结果。
3. 汇总输出：
   - 有改动：按“M 修改 / A 新增 / D 删除 / ?? 未跟踪”等状态归类，列出主要文件或目录，保持简洁。
   - 无改动：明确说明“工作区干净，没有改动”。
4. 只报告 git status 结果，不主动运行其他命令或修改任何文件。
