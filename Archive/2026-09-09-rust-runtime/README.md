# Rust 运行时归档（2026-09-09）

本目录按用户要求归档原 `AgentCore/` 与 `Server/`，为 TypeScript 宿主与 pi 集成方案让出生产目录。

## 内容和基线

- `AgentCore/`：原宿主无关 Rust 领域、循环和本地工具 crates，文件原样移动。
- `Server/`：原 Rust Server 子模块，保留子模块身份、历史与工作树；`.gitmodules` 和子模块 gitdir 路径已由 `git mv` 更新。
- 归档前主仓库 HEAD：`c3359d12311ad23c49e6f57b715e6f869bb4654a`。
- Server HEAD：`e6c1946f72256af28268dac64698f5282e54ce17`；归档前子模块工作树干净。
- 未移动 `Data/`、`Connectors/`、`frontend/`、启动脚本或参考仓库；前端已有未提交修改保持原状。

## 当前状态

新的 TS `Server/` 和 `packages/` 已开始实现，未迁移旧运行数据。
新 npm 开发入口和 CI 已切换 TS，原入口的副本保存在本目录 `tooling/`。
根 `Cargo.toml` 和部分桌面/发行入口仍待迁移；原 Rust 工作区不能直接在新结构中运行。
本目录不是可独立构建的完整历史工作区；如需复现，使用上述主仓库提交及其递归子模块另建检出。
不要运行旧启动入口来尝试自动迁移数据。旧文档的 `Server/`、`AgentCore/` 路径属于归档前结构。

## 恢复目录位置

仅在根目录尚未创建同名新实现时，依次执行以下操作；如果已有 TS Server，应先为它安排独立保存路径。

```sh
git mv Archive/2026-09-09-rust-runtime/AgentCore AgentCore
git mv Archive/2026-09-09-rust-runtime/Server Server
```

移动使用 `git mv`，因此重命名与 `.gitmodules` 变更已暂存，尚未提交。

后续设计见 [TS 宿主与 pi 实现方案](../../文档/技术/Eden%20Agent%20TypeScript%20宿主与%20pi%20实现方案.md)。
