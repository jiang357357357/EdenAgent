# Eden Agent 前端全局配色规范

当前默认主题为深色雾紫。调色板唯一来源是 `frontend/web/src/theme.css`，由 `index.css` 导入；页面不再重复定义 `--color-*`。“界面外观”提供雾紫、晴蓝、薄荷、玫瑰、暖金五组强调色预设，通过根节点 `data-accent-theme` 切换。`ui.appearance` 的 `accentTheme` 按账号/世界保存，旧记录默认雾紫。强调色预设联动主色、悬停、按下、淡色背景和按钮前景。整体主题新增深色夜幕、奶油米色、暖杏桃色、清新浅绿、雾紫暮色，以 `baseTheme` 保存；页面渐变、卡片、输入框、边框、文字、状态色及原生控件的明暗共同切换。浅色主题使用更深的强调色和状态色。`backgroundMode` 在主题渐变与聊天壁纸之间切换，选整体主题自动展示渐变；旧记录保留夜幕与壁纸模式。

## 语义颜色

| 用途 | Tailwind 类示例 |
| --- | --- |
| 页面、卡片、输入区域 | `bg-bg`、`bg-card`、`bg-input` |
| 浮层、遮罩、浅色高光 | `bg-overlay/90`、`bg-scrim/65`、`bg-highlight/10` |
| 边框、悬停、禁用 | `border-border`、`bg-surface-hover`、`bg-surface-disabled` |
| 正文、次要、弱化、禁用文字 | `text-text`、`text-text-muted`、`text-text-lighter`、`text-text-disabled` |
| 主按钮 | `bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-active` |
| 选中项、轻量强调 | `bg-accent-dim text-accent` |
| 成功、警告、错误、信息 | `text-success`、`text-warning`、`text-danger`、`text-info` |
| 状态提示背景 | `bg-success-dim`、`bg-warning-dim`、`bg-danger-dim`、`bg-info-dim` |
| 深色实底状态按钮 | `bg-success-solid text-on-solid`，其他状态同理 |
| 代码、滚动条 | `bg-code`、`--color-scrollbar` |

默认强调色 `#A99BEF`、悬停色 `#BDB1FA`、按下色 `#9685DF`，主按钮采用深色前景。修改主题时修改语义变量，不逐个页面换色。状态色保持自身含义，不全部替换为强调色。

## 组件约束

- UI 使用语义颜色类，禁止 `bg-white`、`text-stone-800`、`bg-orange-50` 等原始调色板类，以及组件内固定 HEX/RGB/HSL。
- 固定色值只写在 `theme.css`。透明度可由组件使用 `/90` 等修饰，渐变与阴影使用 `var(--color-...)` 或 `color-mix()`。
- 不通过覆盖旧类名模拟主题；直接修正颜色的来源和用途。
- 主按钮前景用 `on-accent`，深色状态实底前景用 `on-solid`。默认、悬停、按下、禁用需要一起处理。
- Markdown 配色全局绑定语义变量，不依赖聊天页面的 `.interface-dark` 容器。该容器仍用于原有字号调节。
- Canvas 不能直接使用 CSS `var()` 作为绘制颜色，需读取元素的计算样式；语音波形从 `--color-accent` 取色，透明度通过 Canvas 的 `globalAlpha` 控制。
- 桌宠窗口保持透明根节点，气泡背景通过 `overlay` 与用户透明度参数合成。
- 日记保留纹理资源，用语义背景色叠加保证深色文字区域的可读性；备忘采用纯色时间列表与详情布局；角色图片和用户壁纸属于内容，不重着色。
- 系统桌面预览仍可使用操作系统返回的壁纸颜色，缺省值使用语义变量。

## 静态门禁与验收

`npm --prefix frontend/web run check:theme` 扫描 `src` 中手写 TS、TSX 和 CSS，拒绝固定色值、原始 Tailwind 调色板和调色板文件外的颜色变量定义。生成协议代码及图像/SVG内容资源不属于扫描范围。

前端 `build` 已接入此检查，再执行 TypeScript 与 Vite 构建。静态检查不等同于界面视觉验收。后续验收应覆盖各业务页面、原生下拉框、审批弹窗、工具展开内容、桌宠透明背景，以及主按钮各状态。

壁纸不叠加固定明暗遮罩。“背景图片可见度”直接控制图片层 opacity：100% 完全显示图片，0% 仅显示下方主题渐变；模糊仍由独立控件控制。
