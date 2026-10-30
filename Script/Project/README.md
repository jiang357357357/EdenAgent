# Project development scripts

本机构建使用根 `.release/current/Agent/`，验收完成后清理完整临时副本。`build_server.mjs <输出目录>` 与导出的 `buildTui(root, output)` 可将编译结果写入该目录，不覆盖正在运行的 `Agent/dist/server`。相对输出路径以 Agent 根为基准。

`package_server.mjs` 支持 `EDEN_AGENT_BUILD_DIR`、`EDEN_AGENT_TUI_PREBUILT=1`、`EDEN_AGENT_PACKAGE_PLATFORM`、`EDEN_AGENT_PACKAGE_ARCH` 和 `EDEN_AGENT_PACKAGE_NODE`；跨目标打包须提供对应架构的真实 Node、许可证及原生依赖，完成目标系统执行验收。依赖清单使用 `/`，Linux 的 `bin/eden` 使用 LF。桌面脚本支持 `EDEN_AGENT_PACKAGE_RUNTIME`、`EDEN_AGENT_PACKAGE_WEB`、`EDEN_AGENT_PACKAGE_OUTPUT` 和 `EDEN_AGENT_POINTER_OBSERVER`；默认路径保持原行为。

`EDEN_AGENT_VIDEO_RUNTIME_PREPARED` 可指向与原视频资源分离、`runtime.json` 完全一致的调用方暂存目录，组装时移动该目录；调用方负责保留 Linux 权限、符号链接及大小写敏感的 terminfo。NTFS 跨平台复制不能代替 POSIX 资源验证。完整桌面清单同时保留类型、权限、摘要及链接边界，摘要并发上限为 16；Linux 制品补入由 Windows 生成的文件记录后，须在 Linux 上核对并记录实际权限，再做全清单校验。

- `setup_video_context.mjs`：用现有 Python 3.11–3.13 与含许可证的 FFmpeg 发行目录准备 Windows 自包含视频运行时。`npm run setup:video -- --python <python.exe> --ffmpeg-dir <FFmpeg目录>`；可用 `--model-dir <tiny模型目录>` 复用模型。安装固定依赖并复制独立 Python，不修改提供的解释器；默认输出为被 Git 忽略的 `Data/runtime/video-context`，拒绝覆盖已有运行时。
- `video_resources.mjs`：Server 构建复制 VideoContext 固定源码和许可；发行时同时复制已准备的 Python／FFmpeg／Whisper 资源。缺少运行时会使打包失败。`node --test Script/Project/video_artifact.test.mjs` 在临时目录测试资源搬迁后的真实启动，不连接 QQ。

- `consolidate_self_awake.mjs`：角色自醒遗留计划维护，使用 `node --import tsx Script/Project/consolidate_self_awake.mjs --database <账号数据库>` 只读预览；应用需 `--apply --fingerprint <预览指纹>`，可用 `--scheduler-state <MonOs state.json>` 投递退役及角色计划。取得写锁后再次检查账号、指纹和空闲状态，保留原计划和历史，不调用模型。新宿主启动时也会自动执行同一角色收敛流程。

- `dev.mjs`：识别伊甸园（默认 `40092`）与尘世（默认 `40093`）的已有服务，再构建 Server 与隔离运行时、补齐缺失世界并启动 Vite Web 与 Electron。仅复用版本、世界、工作区及能力令牌均匹配的 Server；两个服务继续使用独立令牌和数据目录。支持持久双世界目录选择；本次创建的子进程退出时记录具体退出码／信号并关闭本次进程组，不停止借用的外部 Server。Web 保留 Vite 热更新，复用的 Server 需由原监管器重启才加载后端源码改动。
- `start_server.mjs`：默认先构建再启动单个世界的 Server；`--built` 使用已有制品，须自行确认其已更新。
- `dev_desktop.mjs`：启动 Web 与桌面壳，Mon 后端沿用已运行的外部服务；桌面壳监管尘世本地运行时。Linux 上优先使用监听中 Mon Server 数据目录的能力令牌；其他环境可用 `EDEN_AGENT_MON_TOKEN_FILE` 显式指定。
- `monconfig.mjs`：读取项目 `.monconfig`。
- `monconfig.test.mjs`：配置读取测试。
- `package_connector.mjs`：通过 `--source <目录> <目标>` 构建任意 TS 连接器包；Node worker、清单和资产及校验清单写入 `dist/connectors/<id>`。
- `prepare_startup_scene.mjs`：用 `node Script/Project/prepare_startup_scene.mjs --source <ShittimLogon-Omega目录>` 准备本地启动教室和角色素材。仅复制固定清单中的 16 个美术文件及 LICENSE／NOTICE／SPINE-LICENSE，生成 SHA-256 清单；目标为 Git 忽略的 `frontend/web/public/startup-scene`。先确认全部源文件可读，再复制，不执行原分发包程序。素材需单独准备，缺失时前端回退到登录组件；素材授权及发行另行处理。详见[启动角色接入记录](../../文档/技术/ts-migration/实施记录/2026-10-20-启动角色场景与登录接入.md)。

Server 使用 Node/TypeScript，`build_server.mjs` 构建主入口、隔离运行时、工作区搜索 worker、桌面 broker 和 Cua worker。Windows 下调用 `build_desktop_observer.mjs`，用 .NET Framework 编译器生成内容哈希命名的输入观察器；独立 C# Computer Use 执行器及其构建脚本已退役归档。`desktop_resources.mjs` 由发行组装器复用，复制 broker、Cua worker、观察器、许可与摘要；运行依赖计划随包收集官方 Cua SDK 及平台原生库。隔离运行时将公开 SDK、Zod 和 TypeBox 一并打包，减少每轮进程重新加载大量模块的开销；主入口仍保留外置运行依赖。宿主和连接器无需 Cargo；旧游戏连接器及其专属 Rust 归档已移除。

桌面运行时内置官方 `@trycua/cua-driver@0.28.0`、平台原生库及受管 `cua-worker.mjs`；发行资源包含 MIT 许可，无需用户另装 Cua 服务。全部 56 个公开工具以 `cua_*` 登记，旧 `desktop_*` 兼容接口继续保留；说明加载只改变展示，执行仍走权限与作用域检查。底层截图与输入直接由 Cua 执行，默认后台，前台须显式选择；Windows 输入观察器仍需 .NET Framework 编译器构建。`node Script/Project/generate_cua_catalog.mjs` 校验实际 SDK 目录，`--write` 用于升级时重新生成并审阅差异。

`node --import tsx --test Script/Project/desktop_artifact.test.mjs` 将制品及依赖搬到临时目录，检查 SDK／原生库、目录、会话生命周期、窗口枚举，以及从旧登记恢复、保留暂停和 broker 认证／停止状态，不截图或发送输入。可用 `EDEN_DESKTOP_ARTIFACT_EVIDENCE` 指定验证报告目录。Windows worker 内置 `koffi@3.3.3` 及平台原生依赖，在 SDK 加载前设置并验证专属进程的 PMv2 DPI；初始化失败明确拒绝，不改变客户端或 Server 的 DPI。

已授权真实桌面测试时，先构建，再设置 `EDEN_DESKTOP_LIVE=1`，运行 `node --import tsx --test Server/tests/integration/desktop/live-cua.test.ts`。该入口创建可见的临时 WinForms 窗口，用实际工具、独立 broker、官方 SDK、应用自有文字／点击／DWM 状态验证输入和窗口调整，结束后清理；默认测试发现会跳过它。2026-10-24 本机 125% 缩放下 8 组通过，包含真实前台输入。QQ、多显示器和硬件接管专项仍待验收。详见[真实窗口验收记录](../../文档/技术/ts-migration/实施记录/2026-10-24-Cua兼容层修复与真实窗口验收.md)。

共享协议为 `eden.desktop.3`。恢复依据实际端点而非登记 PID：离线时允许启动内置服务，在线不兼容版本需要启动器协调，不能通过删除控制状态绕过检查。Windows 登记原子替换带有界重试；开发双世界会收到显式 `EDEN_AGENT_DESKTOP_BROKER_ROOT`，未配置时保持现有默认。详见[Cua 内置接入记录](../../文档/技术/ts-migration/实施记录/2026-10-24-Cua官方运行时内置与完整工具接入.md)和[旧登记恢复修复](../../文档/技术/ts-migration/实施记录/2026-10-24-桌面服务旧登记恢复与在线修复.md)。

`dev.mjs` 的等待逻辑见 `runtime_children.mjs`；独立桌面入口有自己的启动等待流程。不得把旧入口的超时或原地复制行为视为当前实现。旧数据只能通过明确快照、暂存导入与激活恢复，不自动覆盖或迁移真实 Data。


迁移实现说明见 `文档/技术/ts-migration/数据迁移操作.md`。测试执行以 AGENTS.md 与当前用户授权为准，只使用独立临时数据，不把真实用户数据库作为测试夹具。未运行的检查不能宣称已验收。`test:server` 默认同时运行两个测试文件，可用 `EDEN_TEST_CONCURRENCY`（1–32）调整；每个文件可能另开运行时进程，增加并发会影响超时测量。

## 浏览器检查与受管 WSL 网页

内置 `browser_inspect` 通过审批后，在独立无登录浏览器中读取渲染 DOM、控制台、页面错误和截图。宿主依赖固定版本 playwright-core，优先使用已安装的 Edge、Chrome 或 Chromium；不自动下载浏览器，不读取现有用户配置。截图存入当前世界 Blob，并作为图像传给模型。独立制品保留 playwright-core 为运行依赖。

`manage_wsl_service.mjs` 导出 `prepare(configPath,input,userId)` 生成可审阅的 JSON、systemd 单元、隐藏启动器及 Windows 登录任务。服务配置包含 distribution、user、directory、bind、port、service（eden-agent-web-端口.service）和 taskName（Eden Agent WSL HTTP 端口）。安装前验证单元，禁止覆盖未知单元或任务；可指定经过命令、目录和所有者验证的现有 Python HTTP 进程接管。无需存储 sudo 密码。

安装：`node Script/Project/manage_wsl_service.mjs install <config.json> [existing-pid]`。状态：`node Script/Project/manage_wsl_service.mjs status <config.json>`。卸载：`node Script/Project/manage_wsl_service.mjs uninstall <config.json>`。Windows 任务使用当前用户登录会话与普通权限，隐藏启动；监管器保持前台 WSL 连接，每 10 秒检查 HTTP 并启动或重启指定单元。它不停止发行版，也不接管未知端口进程。配置旁的 status.json 和 log 记录健康与错误。注销前未运行的登录触发器、整机重启和休眠恢复需分别验收。

凭据维护：`inspect_latest_memory.mjs` 只读检查最近账号、聊天角色与记忆 id=30 的凭据标记，不输出正文。`sanitize_memory_credentials.mjs <database> <session> <character> <memory-id> <updated-at> [--apply]` 默认准备清理统计，应用时要求精确账号归属、记录版本及空闲状态；清理相关历史、重建请求内容哈希，并展开受影响流式消息，最后将该条记忆改为由用户保管的引用。该命令属于真实数据维护，不能拿真实库做测试。`npm run test:maintenance` 使用合成临时 SQLite 和独立 HTTP 服务验证维护逻辑。

## 当前浏览器与发行入口

`generate_rpc.mjs` 读取 TS API 和浏览器模板，并将共用的 frontend/web/src/lib/rpc-client.ts 纳入来源摘要。模板重导出同一运行逻辑，当前前端直接引用它；2026-10-22 桌面控制协议接入时已执行生成器。

桌面发行脚本位于 frontend/Script/Project：package_desktop.mjs 组装资源与签名覆盖的 release-tools，archive_desktop.mjs 生成保留文件权限的归档，sign_release/verify_release 处理独立签名，install_release 安装新版本目录，select_version/launch_version 选择并监管版本，setup_launcher 固定可信 Node 与公钥。完整前置条件与未完成项见文档/技术/ts-migration/桌面发行操作.md。

.github/workflows/windows-frontend-build.yml 现为手动 Linux/Windows TS 桌面组装。连接器工作流为 `connector-build.yml`，只依赖 Node。桌面工作流仅 Windows 指针观察组件保留 Rust 工具链。写好工作流不代表本轮已触发或通过。

## 系统技能目录

`EDEN_AGENT_MON_SYSTEM_SKILL_ROOTS` 与 `EDEN_AGENT_LOCAL_SYSTEM_SKILL_ROOTS` 分别接收 JSON 绝对路径数组，每个根目录的直接子目录是一份含 SKILL.md 的技能包。最多 16 个根目录、512 个技能和 64 MiB 总内容；未配置时为空，不扫描用户主目录或自动接管旧 Data/skills。开发、独立服务及桌面启动均按当前世界传递配置，不从另一世界借用目录。

正常宿主启动时读取完整快照，失败则拒绝启动；审阅模式不扫描。正常运行每 2 秒重扫，skill.refresh 可主动刷新，skill.catalog_status 返回刷新错误与代码隔离可用性。每个目录类别独立发布完整快照；扫描失败保留该类别上次有效快照并报告错误，下一轮继续尝试。源码目录不会被安装/卸载 RPC 修改。

当前工作区自动发现 .agents/skills 与 .edenagent/skills 的直接子目录，拒绝重定向根路径和技能包符号链接。工作区切换后旧目录立即失效，新目录在下一次扫描后可用。同名选择顺序为项目安装、工作区发现、用户安装、插件贡献、系统目录。系统启停按世界保存，工作区发现技能的启停还绑定工作区。管理页可停用发现技能，但移除需要调整源目录。

运行中的主会话、子任务与多角色执行在下一次模型请求构造时刷新工具及技能发现提示；已开始的执行保持审批快照，内容摘要或工作区改变则拒绝复用旧调用。load_skill 与 read_skill 共用读取检查；技能代码工具按声明原名注册并复用 run_skill_tool 审批，重名冲突明确拒绝，不覆盖宿主工具。角色技能必须声明 subagent 场景。以上仅完成源码，尚未启动、读取真实技能包或测试。

## 共享外部进程隔离器配置

管理员可为 TS 宿主设置 `EDEN_AGENT_EXTERNAL_SANDBOX`（规范绝对可执行文件路径）和 `EDEN_AGENT_EXTERNAL_SANDBOX_SHA256`。两项必须同时存在。适配器调用保留旧接口 `--workspace <root> --cwd <root> --launcher <bash|powershell|program|mcp> -- <program> <args...>`，须落实仅指定工作区和无网络的隔离策略；宿主不替它实现 OS 隔离。设置后需重启宿主，普通模型工具不能改这些启动配置。

启动探测只证明适配器能启动，不能证明其安全性。外部后端不接受宿主额外可写目录或网络开关；未通过探测时拒绝执行，不自动降级。同一世界的命令服务、技能代码和 MCP stdio 共享同一配置实例：终端使用 bash/powershell，技能使用 program，MCP 使用 mcp，与归档 Rust 进程接口一致。技能以 JSON stdin 输入，MCP 保持双向 stdio；两者仅传入校验后生成的临时包快照，Node 指向当前宿主的确定可执行文件。适配器必须支持对应 launcher、原样参数传递、指定 cwd 和流式 stdin/stdout。技能启动时另行探测 program 支持，MCP 启动失败由生命周期记录错误，均不退回本机执行。插件模块的独立 worker 隔离不在此接口内。上述实现未实际运行验证。

双世界可以分别设置 `EDEN_AGENT_MON_EXTERNAL_SANDBOX` / `EDEN_AGENT_MON_EXTERNAL_SANDBOX_SHA256` 与 `EDEN_AGENT_LOCAL_EXTERNAL_SANDBOX` / `EDEN_AGENT_LOCAL_EXTERNAL_SANDBOX_SHA256`。当前世界专属变量只要出现任意一项，就必须提供完整有效的一对；不借用公共配置的另一半，空字符串也视为配置错误。两项均未设置时才使用上面的公共配置；公共配置表示管理员明确允许两个世界使用同一隔离器程序，各次调用仍传入各自获批的工作区。

开发双服务、桌面托管和独立 Server 最终都由宿主配置加载器选择当前世界的配置。前两者仅向子进程转发公共变量与该世界的专属变量，不转发另一个世界的隔离器配置。配置加载后显式注入命令、技能和 MCP 服务，各服务不再分别选择外部隔离器。开发入口同时传递模型计价、允许来源与 Blob 上限配置，避免独立启动与开发启动行为不同。本轮仅编写源码，未启动这些入口。
## 开发入口与常驻服务共存

根目录 `npm run dev` 不再强制接管固定端口。后端端口已有服务时，先核对 `/healthz` 中的版本、世界及工作区，再读取所配置数据目录的 `capability.token`（可用逐世界 `EDEN_AGENT_MON_TOKEN_FILE`／`EDEN_AGENT_LOCAL_TOKEN_FILE` 指定），并验证 WebSocket 能力握手；验证阶段不初始化账号、不发送业务 RPC。匹配时复用原服务和令牌，不把外部 Server 纳入开发端的退出清理。不匹配、令牌不可用或 Web 端口已占用时明确失败，保留现有监听进程。此规则避免 Windows 开发入口与自动重启的 MonPM 互相结束进程，见[排查与验收记录](../../文档/技术/ts-migration/实施记录/2026-10-18-开发启动与MonPM端口冲突修复.md)。

`cd frontend && npm run dev` 使用 `dev_desktop.mjs`，不接管伊甸园后端端口；只启动 Web 与 Electron，并由桌面壳按自身配置管理尘世本地运行时。通用 `takeOverTcpPort` 仍供明确需要接管的旧入口使用，不代表根目录开发入口仍采用该策略。不要通过删除锁文件或轮流强杀监听进程解决双启动器冲突。

## Mon 部署路径与启动诊断

每个伊甸园数据目录的 `mon-service.json` 显式绑定一套 Core 部署。`deploymentRoot` 可使用相对于该 JSON 所在目录的路径；`authFile` 和可选 `scheduleStateFile` 相对于部署根解析，绝对路径继续支持。不设置 `deploymentRoot` 时，相对文件路径直接相对于 JSON 所在目录解析。不要通过自动搜索另一套认证文件来绕过缺失配置。

启动会检查配置格式、文件可读性以及 `MON_SERVICE_SHARED_SECRET` / `MON_SERVICE_USER_ID` 是否完整。显式环境认证必须完整提供；同一部署可用绝对路径 `MONOS_SELF_AWAKE_STATE_PATH` 指定可读的 MonOs 调度状态文件。显式环境配置不与 `mon-service.json` 混合；未指定调度文件时，自醒定时工具不可用。认证内容不写入诊断消息。Core 连接错误显示底层错误码与目标 origin，不包含令牌、请求体或 URL 查询参数。

若 Web 启动出现 `ENOSPC` 且 syscall 为 `watch`，可临时使用 `CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=1000 npm run dev` 绕过文件监听数量限制；这与认证路径缺失是两类问题，不需要复制认证文件或修改系统限制。
