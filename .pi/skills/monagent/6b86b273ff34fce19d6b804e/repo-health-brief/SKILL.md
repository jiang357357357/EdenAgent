---
name: repo-health-brief
description: 当用户说“仓库健康速报”时，运行 git status --short，只汇报修改数量、未跟踪数量和子模块是否有改动，不展示完整文件列表。
metadata:
  monagent:
    display_name: 仓库健康速报
    version: 1.0.0
    tools:
    - bash
    - grep
    profiles:
    - user_chat
---

触发条件：用户说“仓库健康速报”（或意思相同的变体）时执行。

执行流程：
1. 在仓库根目录运行 `git status --short`，保存完整输出。
2. 统计（用 bash 管道或逐行判断均可）：
   - 修改数量 = 不以 `??` 开头的状态行数（涵盖已暂存/未暂存修改、删除、重命名等）。
   - 未跟踪数量 = 以 `??` 开头的行数。
   - 子模块是否有改动 = 满足以下任一即视为有改动：
     a. `git submodule status` 输出非空（子模块指向不同提交、未初始化或冲突）；
     b. `git status --short` 中存在与 `.gitmodules` 注册路径匹配的状态行（含第三列 M/?，即子模块内有未提交内容）。
3. 汇报格式（保持简洁，不列文件明细）：
   - 修改：N 项
   - 未跟踪：N 项
   - 子模块：有改动 / 无改动
4. 若 git 命令报错（如不在仓库内），如实汇报错误，不要伪造结果。
