# 中文 Markdown 加粗星号未渲染

日期：2026-10-06。模块：Web 共享 Markdown 渲染组件。

## 原因与实现

用户截图中的列表内容包含 `的**「圣所塔」 支配权**——`。`MarkdownContent` 已使用 ReactMarkdown 与 remark-gfm，列表也正常形成 `<ul>/<li>`；在真实组件的静态 React 渲染中，原文仍显示星号。CommonMark 强调边界将引号视为标点，紧贴其外侧的中文文字使强调起止不能被识别。

[CJK 兼容扩展的原始说明](https://github.com/tats-u/markdown-cjk-friendly/blob/main/packages/remark-cjk-friendly/README.md) 明确说明这类起止边界问题。采用 `remark-cjk-friendly@2.3.1`，在原 remark-gfm 后接入 `parseOnly` 插件；扩展由 micromark 处理强调语法。没有替换原文、插入额外空格或把原始消息转换为 HTML。普通正文、列表、表格、旧消息及有序文本片段共用该组件。

`frontend/web/package.json` 固定插件版本；根 lockfile 只增加该依赖声明及五个新增包，没有修改现有包的版本或删除包。解析入口不加载反向 Markdown 序列化实现，新增包随前端构建进入 JS，无服务端模块变更。

输入仍为原始 Markdown，输出仍为 React 元素。代码块、行内代码和反斜杠转义由原解析链处理；原始输出/存储内容及用户纯文本继续保留星号。流式输入在配对星号到达后重新识别，未闭合的强调暂时显示原文。

## 验证

新增 `frontend/web/tests/markdown-cjk-rendering.test.mjs`，加载真正的 `MarkdownContent` 与 `MessageBubble`，直接验证渲染结果。八项覆盖：截图列表、两端中文标点、链接/行内代码/嵌套斜体、两种回复布局与原始输出、逐步到达的闭合星号、代码及转义保护、英文/GFM 表格/删除线、独立动作和用户纯文本。修复前六项失败；修复后全部通过。

以下命令在 `frontend/web` 运行：

```text
node --test tests/markdown-cjk-rendering.test.mjs tests/message-actions.test.mjs tests/reply-duration-rendering.test.mjs
npm run typecheck
npm run check:theme
```

共 17 项测试通过；类型检查通过，主题检查通过（264 个文件）。使用安装自带 Node 22.23.1 另行执行八项新回归，通过。未运行真实模型、读取用户数据库或改写历史消息。

Vite 基线及候选生产构建通过，保留既有大 chunk 提示。测试验证生成的 `<strong>` 及其内容；未进行真实 Electron 桌面视觉验收。

## 本机更新与加载

任务、源码快照、构建报告及备份：`E:\EDEN\.release\agent-markdown-cjk-20261006`。

第一次基线构建中发现前一项提醒连接修复新增的两个 API 契约会改变 Web 构建哈希。提醒专用模式由桌面主进程使用，本次局部 Web 修补在基线和候选构建中均以只读内存覆盖保留已安装的两个 API 契约内容；未回滚源码。修改前 Markdown 组件参与构建时，19 个文件与当前安装逐字节一致；候选只接入本次 Markdown 扩展。

- 候选仍有 19 个文件；CSS 字节及静态资源保持一致。
- 备份旧主 JS、Spine JS 和入口；写入新的 `index-d8uNFCoh.js`、`SpineCharacterCanvas-ClVJkvhd.js`，最后替换 `index.html`。旧资产保留，全部候选文件的 SHA-256 已校验。
- VERSION、BUILD-INFO、桌面 manifest、工作区锚点和 MonPM 配置哈希不变。没有改写用户配置、数据库、版本或发行元数据。
- 本机证据：`EDEN_win/Data/Diagnostics/Agent-markdown-cjk-fix.json`，包含构建来源、冻结契约哈希、依赖变动与文件备份信息。
- 源码开发界面刷新后使用新渲染器；便携桌面重新打开后加载新入口，历史消息无需重新发送。

未中断用户进程、提交推送或正式发布。
