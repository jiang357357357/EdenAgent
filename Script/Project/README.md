# Project development scripts

- `dev.mjs`：分别启动伊甸园 TS Server（默认 `40092`）与尘世 TS Server（默认 `40093`），再启动 Web 与 Electron；两个服务使用独立令牌和数据目录。支持持久双世界目录选择；创建的子进程退出时停止本次开发进程组，不把端口上的其他服务当作本次已启动实例。
- `dev_desktop.mjs`：仅启动 Web 与桌面壳。
- `monconfig.mjs`：读取项目 `.monconfig`。
- `monconfig.test.mjs`：配置读取测试。
- `package_connector.mjs`：通过 `--source <目录> <目标>` 构建任意 TS 连接器包；Node worker、清单和资产及校验清单写入 `dist/connectors/<id>`。

Server 使用 Node/TypeScript，`build_server.mjs` 构建主入口及六个独立迁移命令，`package_server.mjs` 组装 Node、运行依赖、连接器和迁移工具。宿主和连接器无需 Cargo；旧游戏连接器及其专属 Rust 归档已移除。

`dev.mjs` 的等待逻辑见 `runtime_children.mjs`；独立桌面入口有自己的启动等待流程。不得把旧入口的超时或原地复制行为视为当前实现。旧数据只能通过明确快照、暂存导入与激活恢复，不自动覆盖或迁移真实 Data。


迁移实现说明见 `文档/技术/ts-migration/数据迁移操作.md`。当前阶段只编写业务与发行实现；未经用户明确要求，不运行测试、构建、迁移或冒烟检查，未运行不能宣称制品已验收。

## 当前浏览器与发行入口

`generate_rpc.mjs` 读取 TS API 和浏览器模板，并将共用的 frontend/web/src/lib/rpc-client.ts 纳入来源摘要。模板重导出同一运行逻辑，当前前端直接引用它；生成器没有在本轮执行。

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
## 固定端口接管

开发启动采用“后启动者接管”规则：启动前释放伊甸园后端、尘世后端和 Web 声明的固定端口。若旧监听进程由 MonPM 监管，启动器会先停止对应 MonPM 应用，避免其自动重启后再次抢占端口。`npm run dev` 与 `cd frontend && npm run dev` 使用同一套双宿主启动流程。

## Mon 部署路径与启动诊断

每个伊甸园数据目录的 `mon-service.json` 显式绑定一套 Core 部署。`deploymentRoot` 可使用相对于该 JSON 所在目录的路径；`authFile` 和可选 `scheduleStateFile` 相对于部署根解析，绝对路径继续支持。不设置 `deploymentRoot` 时，相对文件路径直接相对于 JSON 所在目录解析。不要通过自动搜索另一套认证文件来绕过缺失配置。

启动会检查配置格式、文件可读性以及 `MON_SERVICE_SHARED_SECRET` / `MON_SERVICE_USER_ID` 是否完整。显式环境认证必须完整提供，整体覆盖文件绑定，不混合账号或调度状态。认证内容不写入诊断消息。Core 连接错误显示底层错误码与目标 origin，不包含令牌、请求体或 URL 查询参数。

若 Web 启动出现 `ENOSPC` 且 syscall 为 `watch`，可临时使用 `CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=1000 npm run dev` 绕过文件监听数量限制；这与认证路径缺失是两类问题，不需要复制认证文件或修改系统限制。
