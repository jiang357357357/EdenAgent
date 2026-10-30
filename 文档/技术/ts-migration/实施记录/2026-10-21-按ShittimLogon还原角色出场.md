# 2026-10-21 按 ShittimLogon 还原角色出场

用户指出前一版角色出现效果与参考项目不一致，并要求“按照原项目修改”。本轮以本机 `ShittimLogon-Linux/src/gl_scene.cpp`、`src/gl_effects.h`、`lockscreen/shittimBackground.py` 的当前源码为依据，替换 10-20 接入版的 CSS 横移、淡入及固定角色布局。保留 Eden 的 Core 认证、尘世入口和登录组件。

## 出场、退场与布局

| 阶段 | 本轮实现与参考源码的对应关系 |
| --- | --- |
| 准备 | 教室和当前昼／夜角色并行加载，在同一个 Pixi 上下文内完成 3 帧预热后开放点击；点击时没有新增素材请求。当前模式已选定，只预加载该模式的单个角色。 |
| 回应 | 保留背景 track 0 和姿态 track 1，将 Touch_A/M 作为 track 2/3 叠加。时长取实际动画的最大 duration，当前素材约 1.166667 秒。 |
| 最后姿势 | Touch 两条轨道保持在 `duration - 1/30`，避免素材最后一帧隐藏角色，导致消失闪光没有可见轮廓。 |
| 原位消失 | 回应后隐藏普通角色槽位，绘制原位白色角色轮廓；闪光强度从 `216/255` 按 0.5 秒线性衰减。 |
| 背景过渡 | 0.4 秒内按 smoothstep 增加模糊。移植原来的九点、水平／垂直分离模糊权重，四分之一分辨率，半径系数 1.6，背景额外暗化最多 0.2；唤醒期间原场景 shade=0.18。 |
| 前景出现 | 原位消失开始 0.4 秒后，在布局计算出的固定位置出现。透明度按 0.12 秒 smoothstep 提升，白色加亮按 0.5 秒衰减；外侧叠加半径系数 1.8、增益 0.5 的轮廓光。没有横向滑入。 |
| 稳定与登录 | 前景出现阶段持续 0.7 秒后显示 Eden 登录组件。当前素材从点击到稳定阶段约 2.27 秒，实际渲染允许帧间隔误差。前景 shade=0.06，并显示原项目同位置、角度、尺寸及昼夜颜色的 15 个三角粒子。 |
| 返回 | 从当前角色透明度和模糊量开始，按 0.25 秒 smoothstep 返回教室。回应中、消失闪光中、出现过程中和登录界面均可按 Esc 返回；取消后不会延迟重新出现。 |

`foreground-layout.ts` 移植当前 Python 布局算法，按真实登录组件的边界及安全间距切分可用区域，选择能容纳角色的区域；表单高度、窗口尺寸和视觉视口变化时重新计算。角色边界来自整个 Idle_01 动画周期。当前原项目源码明确允许下半身超出视口，优先低位构图；因此不能沿用此前“原项目始终完整显示身体”的描述。窄屏会使用登录框下方仍足够大的区域，空间不足时隐藏前景角色。

课堂的既有竖屏镜头平移仍用于保证初始角色可点击。登录框外观、运行世界切换、认证错误和已有登录态沿用 Eden，属于应用适配。复用了参考项目的阶段、参数、轮廓特效和避让算法；不同视口、GPU 后端和登录控件布局下不宣称逐像素相同。

## 代码职责与失败行为

- `scene-transition.ts`：纯阶段与时间线，使用参考源码的时长、smoothstep、返回起点及最多 0.5 秒的阶段时间增量。
- `scene-models.ts`：Spine 素材加载、动画与最后姿势、角色槽位及姿态快照、全周期角色边界、镜头和避让布局。
- `scene-effects.ts`：原位白色轮廓、前景加亮、轮廓光、九点模糊和粒子；离屏目标提前分配并在销毁时释放。
- `scene-renderer.ts`：唯一 Pixi 上下文、加载和预热、ticker、布局更新、阶段通知及资源生命周期。React 只在阶段变化时更新界面。
- `StartupSceneCanvas.tsx`：渲染器生命周期、点击区域与输入命令。原先的 `StartupRoomCanvas.tsx`、`room-renderer.ts` 已移除。
- `StartupEntrance.tsx`：场景命令、显示阶段、跳过、返回和可见状态下的 8 秒过渡兜底。登录组件在过渡期间隐藏且 inert，提前测量大小，稳定后才开放焦点和操作。
- `StartupLoginPanel.tsx`：登录与焦点约束，报告实际控件边界；认证调用方式不变。

素材读取保持 12 秒超时，加载完成后取消该计时，预热可以等待窗口重新可见；隐藏文档暂停渲染与阶段推进。素材、懒加载或渲染异常保留现有登录回退，并在控制台说明场景错误。极小离屏目标保证至少有一个物理像素。所有本轮准备的图像、骨骼和许可文件继续只在本机 Git 忽略目录中使用，未更换美术素材或增加依赖。

## 实际验证

Node.js 22.23.1，在 `frontend/web` 执行：

```powershell
node ../../node_modules/typescript/bin/tsc --noEmit
node scripts/check-theme.mjs
node ../../node_modules/vite/bin/vite.js build
node --experimental-strip-types --test tests/startup-transition.test.mjs tests/runtime-origin.test.mjs tests/spine-initialization-race.test.mjs tests/spine-unfocused-rendering.test.mjs tests/spine-layout.test.mjs tests/spine-interactions.test.mjs tests/app-error-boundary.test.mjs
node --experimental-strip-types --test tests/startup-entrance-renderer.test.mjs
```

类型检查通过；主题检查 **302 文件通过**；Vite 生产构建通过，保留既有超过 500kB chunk 提醒。原有相关回归 31 项，加本轮时序／返回／布局 8 项，合计 **39 项通过**。本轮 12 个启动模块使用项目源码规模与复杂度规则额外检查，零错误、零提醒。

独立 Electron 验收使用原始 Spine 素材、真实动画、着色器和时间线，**21 个验收点通过**，覆盖白天四种／夜间五种房间姿态的阶段顺序、最后可见姿势保持、预热后点击不加载新素材、实时登录框避让、0.25 秒返回、重复进入、回应／闪光阶段 Esc 取消、窄屏、资源缺失、缓存认证、登录失败重试、尘世入口、完整 App 主入口及辅助窗口。页面错误与着色器错误均为零。认证仅用本地 HTTP 合成账号回执，未连接生产 Core 或读取真实用户数据库。

阶段验收基于实际 ticker 写出的帧观察，逐帧保存阶段、动画 trackTime、闪光、透明度、模糊与布局。退出／进入闪光仅持续较短时间，测试从同一帧真实 Pixi canvas 保存 PNG；稳定界面使用 Electron offscreen 的新 paint 图像，记录 paint 计数与阶段。没有暂停时间线、伪造完成事件或修改动画时长来取得阶段截图。

迭代中真实渲染先后暴露四分之一分辨率 1×1 目标被取整为零，以及 GLSL 顶点／片元 inputSize 精度不一致的问题，均在生产代码中修正。原隐藏窗口 `capturePage` 会返回上一张已合成画面，导致文件名与短暂阶段不一致；已改为上述逐帧记录与新 paint 截图，没有放宽阶段顺序或零图形错误要求。初次测试直接用 Node strip-types 读取参数属性失败，也已将纯时间线类改为可直接擦除类型的字段声明。失败诊断 JSON 保留，不混入最终通过结果。

证据：`.artifacts/startup-entrance-20261021/renderer-result.json`、`renderer.log`、`stage-traces.json`、`capture-observations.json`、`verification.json` 与各阶段／布局 PNG。`verify-evidence.mjs` 核对三个参考源码的摘要、当前 12 个启动模块的摘要与门禁、19 个原始／public／构建素材的哈希、21 个验收点及截图所属阶段。测试使用独立临时 profile 和服务，结束后验证临时目录边界并清理。

源码和开发 Web 构建已更新。未重启现有服务、改动用户账号数据、重新打包桌面发行程序、提交推送或发布；真实 Core 凭据登录和客户机 GPU 仍需各自环境验收。
