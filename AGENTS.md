# 项目定位

这是 MonAgent 的精简学习版，目标是将 AI 编程代理改造为**通用个人助手**。

## 当前状态
- 已删除全部非终端/TUI 的模块（Web UI、桌面应用、文档站、企业版等）
- 保留核心引擎：会话循环、工具系统、Agent 系统、Provider 系统
- 包结构精简至 5 个：core / opencode / plugin / script / sdk

## 改造方向
1. System prompt 从"编程代理"改为"个人助手"
2. 新增日常工具：浏览器操作、截图、系统控制
3. 新增记忆系统：长期记忆、用户偏好
4. 保持终端 TUI 体验，侧重对话而非代码编辑

## 技术栈
- Bun 1.3+ / TypeScript
- Effect-TS v4（核心架构框架）
- Vercel AI SDK（LLM 调用）
- SolidJS + OpenTUI（终端界面）
- Drizzle ORM + SQLite（持久化）
