# GitHub 发布检查表

Eden Agent 公开发布前必须同时满足以下条件：

1. 撤销或轮换所有曾进入 Git 历史的 API 密钥，即使当前文件已删除。
2. 使用不包含旧提交的干净发布历史，或对全部分支和标签完成历史清理后重新扫描。
3. `.monconfig`、`.env`、`Data/`、临时参考仓库和角色二进制资源不在待发布文件清单中。
4. `AgentAssets` 保持私有；只有来源、作者和再分发授权均完成核验的资源才允许公开。
5. 先公开并验证 `EdenAgentFrontend`、`EdenAgentServer`，再发布包含相对 submodule URL 的主仓库。
6. 完整执行 Rust 检查、Web 类型检查、Web 测试和 Desktop 测试。
7. 检查 PolyForm Noncommercial、商业授权说明和全部第三方许可证声明。

不要直接把现有开发历史原样镜像到新的 GitHub 仓库。建议从复核通过的源码快照建立新的公开根提交，并保留本地 bundle 作为旧历史备份。
