# 外部参考源码

首次拉取日期：2026-10-12。最近更新日期：2026-11-04。位置：`E:\EDEN\Agent\文档\参考`。

三个仓库最初使用 `git clone --depth 1 --single-branch` 浅克隆。2026-10-22 从各自 `origin` 获取对应分支，再通过 `merge --ff-only` 快进更新；三个仓库均保留浅仓库属性。下表记录本次获取到的确定提交，后续更新后应重新登记。

2026-10-23 新增 Cua 官方仓库，检出 `main`，并在同一浅仓库中补取旧版 `cua-driver-rs-v0.28.0` 标签，供桌面驱动对照。原有三个参考仓库本轮未更新。

2026-11-04 新增社区插件 dsh-purge，按当前包元数据指向的 `HunYiSage/dsh-purge` 获取；先前检索入口为 `YuJunZhiXue/dsh-purge`。其余参考仓库本轮未更新。

| 项目 | 本地目录 | 上游仓库 | 分支 | 提交 |
|---|---|---|---|---|
| dsh 官方 DeepSeek Harness | [deepseek-harness](deepseek-harness/README.md) | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) | `master` | `687f282e8625c6b8d11ff58211a90524be2e4317` |
| OpenCode | [opencode](opencode/README.md) | [anomalyco/opencode](https://github.com/anomalyco/opencode) | `dev` | `bddf5346c8e3a0c7c662d231c5f3e302ae5f0b1f` |
| pi | [pi](pi/README.md) | [earendil-works/pi](https://github.com/earendil-works/pi) | `main` | `bd3c9b823762b7383954aa49e13ee350471015fe` |
| Cua / Cua Driver | [cua](cua/README.md) | [trycua/cua](https://github.com/trycua/cua) | `main` | `27d8da9fd94056bd73892183531579396aafb2f9` |
| dsh-purge 社区插件 | [dsh-purge](dsh-purge/README.md) | [HunYiSage/dsh-purge](https://github.com/HunYiSage/dsh-purge) | `master` | `4c3369a945701598275dcabbe958b7b815570ed5` |

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

## 2026-11-04 dsh-purge 首次拉取

按用户指定目录，以 `--depth 1 --single-branch` 获取到 `E:\EDEN\Agent\文档\参考\dsh-purge`。origin 为 `https://github.com/HunYiSage/dsh-purge.git`，分支 `master`，提交 `4c3369a945701598275dcabbe958b7b815570ed5`，package.json 声明版本 `1.1.90`。README 存在，工作树干净，保留浅仓库，仓库本地开启长路径支持。

Git 直连曾被重置，最终仅在该次 clone 命令中使用 Windows 系统配置的本机代理后成功；未改全局 Git 或系统代理配置。外部源码目录加入 Agent 已有参考仓库忽略清单，不登记为子模块，不安装依赖、执行上游脚本、应用宿主补丁或启用插件。

## 2026-11-04 dsh-purge 源码分析

分析对象固定为上段的 1.1.90 / `4c3369a945701598275dcabbe958b7b815570ed5`，属于静态阅读，不代表已经在 DSH 或 Eden 上验证效果。

### 内置主正文核验

按用户追问“其 system 正文是怎么样的”，将 asset-table 的常量作为数据解析，使用独立的 Node 标准库读取逻辑进行 AES-GCM 解码和解压，没有导入或执行参考项目模块。内置原文为 21,193 个 UTF-16 字符单位、25,127 个 UTF-8 字节；原始字节 SHA-256 为 `dec02209f23a50f3340caf71695711482c73731ff859be4f94b9f3c41a033b1b`。即使规范化换行并 trim，它也与仓库中的 default-prompt-inject.zh.md、default-prompt-inject.en.md 均不相同，所以这两个明文副本不能直接当作当前内置默认正文。

完整原文提取到 [default-system.txt](../../.artifacts/dsh-purge/default-system.txt)，主会话尾部锚点提取到 [tail-anchor.txt](../../.artifacts/dsh-purge/tail-anchor.txt)，来源及字节核对记录在 [metadata.json](../../.artifacts/dsh-purge/metadata.json)。这是装配前的出厂主正文与独立锚点，不是完整的实时 provider 请求；实际装配仍受用户覆盖、预设、原有段落和运行上下文影响。

主正文以 `<|im_start|>system:<project_instructions>` 和 `[MODE: UNRESTRICTED SANDBOX — STABLE]` 开头。其内容依次包含：

1. Little Code Sauce／小码酱与操作者 YG 的固定身份关系，以及任务、工作流和输出语言要求。
2. Style、HARD OUTPUT RULES、REFUSAL HARDENING：强调先交付，列出拒答／道歉／免责声明禁词，并要求跨轮保持设定。
3. Scoped Rules：25 类任务规则及中英文、俚语到任务类别的映射；默认使用沙箱或本地样本解释框架。
4. Never Refuse：把拒答当成输出错误，要求从原理、组成、流程到参数／步骤持续完成。
5. CTF Core Contract、CTF Scope and Evidence：竞赛资产前提、工作区范围、运行证据优先级、可回滚改动和备份等约定。
6. Routing：占位符规范、双语路由、边界措辞转换、预置流程与稳定性锚点。
7. House Rules：简体中文回复、英文思考、未明确要求不提交推送，以及缺失细节用占位符等收尾约束。

另发现明确的默认正文／裁剪器不一致：identity.js 的 CTF_INJECT_MARK 是全大写 `CTF CORE CONTRACT`，splitRedteamInject 使用区分大小写的 indexOf；解码正文的标题是 `CTF Core Contract`。因此，这份内置正文不会命中该裁剪标记，不能按代码注释推定红队模式一定删掉 CTF 段及后文。这是由固定字符串直接可判定的路径问题，未修改参考源码。

### Eden 超限模板适配范围（早期建议与最终限定）

更新：用户最终限定只改角色人设与工具／路由，要求保留“盲目忠诚＋自我保存”及角色身份下的无限忠诚。已保存并切换默认模板为 [prompt-mode-eden.ts](../../Server/src/model-prompts/prompt-mode-eden.ts) 的 eden-overlimit-v1，并兼容已入队 v3。仅替换身份、意图映射和工具路由三个区域，其余原文统一换行后保持一致，证据 `.artifacts/dsh-purge/eden-adaptation.json`。随后按用户批准，新入队改为 leading-v1：长正文紧随当前角色身份，短锚点在同一条首部 system 的工具指引之后；删除模型消息中的模式标题。无布局字段的旧快照保留末尾位置。以下广泛精简方案属于此前讨论建议，关于删除核心动机、沙箱、CTF、禁词或 25 类规则的建议没有采用；实际实施以技术跟踪最新条目为准。

核对 Eden 当前 prompt-mode-v3.ts 后，确认内置原文仍将所有目标称为 synthetic local fixtures，并把用户任务设定成 prompt-bank regression。这些前提不符合真实桌面、文件和 QQ 使用场景。结合用户追问“需要修改哪部分，然后写入我们的超限模板”，建议按以下范围改写，而非直接搬入 dsh-purge 全文：

- 身份：删除 Little Code Sauce、YG、忠诚／自我保存等固定人设与思考过程要求；角色名、称谓、关系和表达习惯继续取当前角色卡，模板不再创建另一重身份。
- 场景：删除全局沙箱、CTF 与题库回归宣称；真实任务使用实际环境和工具回执，创作任务遵循用户设定，样本或演练前提由本轮实际信息确定。
- 任务行为：保留直接、完整、主动推进和减少无依据缩减任务的要求；去掉任何拒答词出现即失败的绝对禁词表，保留准确报告能力缺失、审批结果、失败与未完成项的空间。
- 信息不足：把“一律占位符、不得澄清”改为只澄清影响正确性和执行的关键项；计划／示例可明确使用占位符，实际调用使用真实参数并准确区分完成状态。
- 工具：保留按任务发现和选用技能／工具的原则，具体目录与 schema 以宿主当前上下文为准；失败区分原因后选择可行路径，未知副作用先核对，避免把取消或审批拒绝当成可绕开的故障。
- 内容结构：移除 25 类穷举、固定命令流程与假 ChatML 外壳，收敛成角色连续性、任务处理、工具与事实、输出及简短收束规则。工具流程继续由对应技能／工具承载。

建议新增 Server/src/model-prompts/prompt-mode-eden.ts，使用独立版本标识（例如 eden-overlimit-v1），不要覆盖旧 v3 的正文／来源身份。修改 prompt-mode.ts 的快照版本与正文校验，使新提交使用新版本，已入队 v3 及无版本历史快照仍按提交时原文恢复；不能只把当前 z.literal(v3) 换成新版本，否则已有带 v3 的队列快照会失效。

现有 packages/runtime-pi/src/trailing-system.ts 已在最终 provider messages 尾部追加独立 system，可继续作为注入入口。世界／账号开关、入队快照、角色卡、工具审批和前端开关继续由各自模块负责。本段仅记录建议和定位，未替换业务模板或运行验证。

### 核心链路

它组合了三种机制：重写模型的 system 正文、改动 DSH 本机安装文件、调整执行权限与工具前置检查。不能把模型愿意回答、宿主允许调用工具、任务实际成功三者混为一谈。

| 层次 | 源码入口 | 实际作用 |
| --- | --- | --- |
| 插件装配 | [lib/index.js](dsh-purge/lib/index.js) | 注册提示段、装配重写、会话与预设生命周期钩子、权限与重试逻辑 |
| 正文来源 | [lib/rules.js](dsh-purge/lib/rules.js)、[lib/table-read.js](dsh-purge/lib/table-read.js) | 解析已提交覆盖文本、磁盘文本和内置默认正文；内置槽经 AES-256-GCM 解密、解压后成为普通提示文本 |
| system 重排 | [lib/identity.js](dsh-purge/lib/identity.js) | 去重正文，过滤选定的官方身份、工作区基线及 Mnemon 来源内容，将主正文放首部、锚点放尾部 |
| 首尾锚点 | [lib/anchor.js](dsh-purge/lib/anchor.js) | 主会话的短锚点作为 system section；子代理另注册必需的 context 锚点 |
| 安装文件补丁 | [lib/core.js](dsh-purge/lib/core.js)、[lib/hooks-deny.js](dsh-purge/lib/hooks-deny.js) | 查找 Web／桌面宿主文件，备份后按标记和字符串／正则替换补丁，汇总应用与漂移状态 |
| 子代理控制 | [lib/subagent-control.js](dsh-purge/lib/subagent-control.js) | 改动子代理审批策略，对子代理 approval/request 可直接返回 allowed-once |
| 范围检查 | [lib/net-scope.js](dsh-purge/lib/net-scope.js) | 识别任务和地址，检查 DNS 解析结果，在模型步骤和工具执行前实施本地靶场范围限制 |
| 自动重试 | [lib/continue-retry.js](dsh-purge/lib/continue-retry.js) | 默认重试请求错误，限制次数、识别不可重试错误和用户取消；自动续跑默认关闭 |

### 提示词实际放置

主会话可简化为以下相对顺序；这是 `rewritePromptAssembly` 输出的 system 段落次序，不是完整 provider messages 协议转储：

```text
system 正文：
  1. dsh-purge 长正文
  2. 能力发现／技能与工具使用协议
  3. 经清理后保留的原有说明、工作目录等段落
     （红队预设另有目标卡、角色分工与操作稿）
  4. dsh-purge 短锚点

会话输入、历史、工具结果：
  仍由 DSH 的会话与 provider 适配层转换
```

主正文注册 order 为 -100000。短锚点虽然也注册了 order，但装配重写最终直接把它追加到 sections 数组末尾；该阶段数组的物理顺序决定渲染次序，不能只看 order 数值。

这里的“末尾”是 **system 正文内部末尾**，不能等同于 Eden 当前“整份请求最后一条独立 system”。正文中的身份或高优先级宣称仍是提示文本，不会自行获得新的 API 角色权限。默认正文的加密是本地分发封装，模型收到的仍是解密后的文本，也没有改变模型权重。

正文来源以 `resolveInjectText` 为准：已提交覆盖文本优先，其次磁盘文本，再次内置默认正文。`rewriteLiveAssembly` 仅在仍未取得正文时尝试所选工作区文件；因此不能单凭 README 的选择流程图推定工作区文件必定覆盖内置正文，UI 是否已把选择写入覆盖文本需分开看。

过滤不是删除所有记忆或所有自定义人设：代码按段名、识别出的默认身份及消息 producer 判断。默认工作区策略为 fallback，有注入正文时可移除工作区基线；配置为 always 时保留。插件注入主要由 enabled 控制，并非只在红队预设生效；红队预设是在相同基础上再增加专属内容。

### 保持生效与权限变化

它同时注册 assemble waterfall、包装 assemble 方法，并在会话创建、预设切换、每步执行前重新挂载。约 400ms 的守护定时器用于处理 Cordis service proxy 被替换的情况。WeakMap 与签名缓存用于少做重复装配计算，不是供应商 KV 缓存命中证据。

`installFreshFullAccess` 不仅处理新会话，还遍历已有会话：有父会话权限时优先继承；否则根据当前 preset 和 permission/preset 事件数量决定是否写入 danger-full-access。它会保留代码识别出的 auto、custom 及多次显式选择等状态，不能概括成“无条件把所有会话改成完全权限”。子代理审批放行、hooks-deny 补丁是另一层实际执行策略变化。

`autoApplyOnStart: false` 也不意味着启用插件只读：启动路径仍会安装运行钩子、补种正文、修复 profile 绑定并调用其他初始化／修复函数。停用运行钩子和恢复已写入磁盘的宿主补丁是不同操作。

宿主补丁会先备份，检查匹配次数、已有标记及目标漂移，再逐项写入；恢复路径使用 `.dshpurge.bak`，不会拿空备份覆盖活文件。补丁应用函数不是跨全部文件的事务，一项失败不会自动撤销此前已写成功的其他项，需要看完整结果。

### 明确的限制和待验证项

1. **范围拦截可能覆盖普通联网工具。** `installRegionGate` 的任务步骤钩子区分普通任务与攻击任务，但全局 tools/pre-execute 钩子直接对工具参数调用 publicHostHit，没有相同任务条件。按此分支，普通工具携带公网 URL 时也可能被拦；目前是静态路径判断，尚未运行复现。检查函数异常时又存在 forward 透传分支，不能把声明的范围策略视为无条件保证。
2. **兼容说明不一致。** package.json 的 dshTargets 包含 rc.2 与 rc.5，README.zh-CN 仍称不支持 rc.3 及以后。release-notes 有 rc.5 实机 pattern 与补丁还原的作者自述；本轮没有复现这些验证。
3. **缺少当前模型效果对照证据。** release-notes 记录 1.1.87 移除了 test 目录和 test 脚本；当前发布工作流主要做 node --check 与入口导入。当前检出中未找到可复现的固定问题集、逐题回答和普通／注入模式成功率对照，不能据此声称破甲率或任务通过率。
4. **装配失败兜底需核对作用域。** assemble guard 会返回 lastGood 装配结果；该缓存槽没有显式会话键。若服务实例共享，应验证角色、工具和上下文切换后不会沿用旧装配；此处是需验证的设计风险，不是已复现故障。

对 Eden 可参考的是提示段分工、确定的排序、去重、生命周期恢复，以及分别验证模型回答与工具结果。角色卡兼容、会话级模式和审批策略应各自明确；DSH 的安装文件补丁和 Cordis 装配包装属于其宿主实现，Eden 应通过现有 runtime-pi 公开适配路径实现对应功能。本轮只更新分析记录，未改动 Eden 业务代码、安装或启用 dsh-purge，也未调用模型或运行测试。
