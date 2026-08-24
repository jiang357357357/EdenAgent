---
name: skill-change-summary
description: 用户说“技能变更摘要”时，运行 git status，并只汇总路径中包含 skill 或 skills 的改动。
metadata:
  monagent:
    display_name: 技能变更摘要
    version: 1.0.0
    tools:
    - bash
    profiles:
    - user_chat
---

当用户说“技能变更摘要”或等价表达时：

1. 在当前工作区执行 `git status --short`，获取仓库当前改动状态。
2. 过滤输出，只保留路径（含重命名前后的路径）中包含 "skill" 或 "skills" 的行。
3. 按改动类型整理摘要（新增、修改、删除、重命名等），列出每个匹配文件及其状态。
4. 如果没有匹配的改动，明确说明“当前没有 skill/skills 路径下的改动”。
5. 只做只读汇总，不要修改、暂存或提交任何文件。
