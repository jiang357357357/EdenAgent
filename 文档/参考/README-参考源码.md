# 外部参考源码

首次拉取日期：2026-10-12。最近更新日期：2026-10-23。位置：`E:\EDEN\Agent\文档\参考`。

三个仓库最初使用 `git clone --depth 1 --single-branch` 浅克隆。2026-10-22 从各自 `origin` 获取对应分支，再通过 `merge --ff-only` 快进更新；三个仓库均保留浅仓库属性。下表记录本次获取到的确定提交，后续更新后应重新登记。

2026-10-23 新增 Cua 官方仓库，检出 `main`，并在同一浅仓库中补取旧版 `cua-driver-rs-v0.28.0` 标签，供桌面驱动对照。原有三个参考仓库本轮未更新。

| 项目 | 本地目录 | 上游仓库 | 分支 | 提交 |
|---|---|---|---|---|
| dsh 官方 DeepSeek Harness | [deepseek-harness](deepseek-harness/README.md) | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) | `master` | `687f282e8625c6b8d11ff58211a90524be2e4317` |
| OpenCode | [opencode](opencode/README.md) | [anomalyco/opencode](https://github.com/anomalyco/opencode) | `dev` | `bddf5346c8e3a0c7c662d231c5f3e302ae5f0b1f` |
| pi | [pi](pi/README.md) | [earendil-works/pi](https://github.com/earendil-works/pi) | `main` | `bd3c9b823762b7383954aa49e13ee350471015fe` |
| Cua / Cua Driver | [cua](cua/README.md) | [trycua/cua](https://github.com/trycua/cua) | `main` | `27d8da9fd94056bd73892183531579396aafb2f9` |

dsh 使用官方 Harness 仓库；之前 TUI 字标调查引用的 `gxinxing/deepseek-harness-tui` 是另一个社区项目。pi 的原 `badlogic/pi-mono` 地址目前重定向至 `earendil-works/pi`，本次直接使用新地址。

三个仓库均已完成检出，工作树干净，`README.md` 存在；各仓库本地开启 `core.longpaths`。外部源码目录沿用 Eden Agent 已有 Git 忽略规则，只作为本地参考，不登记为项目子模块。未安装依赖、执行上游脚本或修改 Eden 的运行时版本。

新增 Cua 仓库同样只作本地参考，已开启仓库级 `core.longpaths` 并加入忽略规则；主分支工作树干净。驱动入口见 [Cua Driver](cua/libs/cua-driver/README.md)。

既有 [DeepSeek Harness 源码分析](deepseek-harness-分析.md) 对应 2026-09-09 的旧提交；本次更新不自动更新那份分析的结论。

2026-10-12 三个检出的终端界面范围、核心实现与 Eden 对照见 [dsh、OpenCode 与 pi 的 TUI 源码分析](2026-10-12-dsh-OpenCode-pi-TUI源码分析.md)。该报告的路径、版本和能力结论仍以当时提交为准；其中官方 dsh 没有随附交互式 TUI 的结论不自动延伸到本次新提交。社区 TUI 不在这三个检出中，本次未重新分析上游变化。

## 2026-10-22 更新记录

| 项目 | 更新前提交 | 更新后提交 |
|---|---|---|
| DeepSeek Harness | `d743267388641bc76f17c45ce8b4c231aed1d32c` | `687f282e8625c6b8d11ff58211a90524be2e4317` |
| OpenCode | `d21b0790a6c146815f28fea604e41e922f009590` | `bddf5346c8e3a0c7c662d231c5f3e302ae5f0b1f` |
| pi | `97195ec3c4a40665a9008c3658e67b0782f33b18` | `bd3c9b823762b7383954aa49e13ee350471015fe` |

更新前后工作树均干净，更新后 `HEAD` 与对应上游跟踪分支一致，三个 `README.md` 均存在。pi 下载曾遇到 TLS 连接中断，以命令级 OpenSSL 后端重试成功，未修改全局 Git 配置。本次仅更新参考源码与记录，未安装依赖、运行上游脚本或测试，也未升级 Eden 的运行时依赖。

## 2026-10-23 Cua 首次拉取

官方仓库 `https://github.com/trycua/cua.git` 已浅克隆到 `E:\EDEN\Agent\文档\参考\cua`。当前 `HEAD` 与 `origin/main` 一致，均为 `27d8da9fd94056bd73892183531579396aafb2f9`，工作树干净。

另取标签 `cua-driver-rs-v0.28.0`，对应提交 `1b50c02e2d34734f64d2d22f54eb76cc97b4a663`，与 DSH 的 `cua-macos/native/upstream.json` 所登记的 Cua 上游版本一致。标签源码对象保留在同一仓库中，没有切换主分支或另建检出；可用 `git -C "文档/参考/cua" show cua-driver-rs-v0.28.0:libs/cua-driver/README.md` 阅读旧版入口。

本轮只拉取源码、核对 Git 元数据并记录版本，未安装依赖、构建、运行上游脚本或测试，也未切换 Eden 的桌面后端。检出证据：`.artifacts/cua-reference-20261023/checkout.json`。
