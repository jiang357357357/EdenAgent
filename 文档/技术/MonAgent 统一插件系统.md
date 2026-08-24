# MonAgent 统一插件系统

## 定位

Plugin 是安装、版本、信任、权限和生命周期的唯一管理单位。Skill、Native Worker、MCP、受控 UI 和声明式 Hook 是 Plugin 持有的组件，不再各自发明安装协议。AgentCore 不认识 Plugin；所有包读取、进程、网络、数据库和权限副作用都留在 Server。

## 包格式 v1

包根必须包含 `plugin.json`。生产包还必须包含覆盖全部内容文件的 `checksums.json` 和 `signature.json`：

```json
{
  "schemaVersion": 1,
  "id": "mon.example",
  "name": "Example",
  "description": "Example plugin",
  "version": "1.0.0",
  "components": {
    "skills": [{ "id": "workflow", "path": "skills/workflow/SKILL.md" }],
    "runtimes": [
      { "id": "worker", "kind": "native_worker", "manifest": "connector/connector.json" },
      { "id": "local-mcp", "kind": "mcp_stdio", "manifest": "mcp/stdio.json" },
      { "id": "remote-mcp", "kind": "mcp_http", "manifest": "mcp/http.json" }
    ],
    "ui": [{ "id": "about", "entry": "ui/about.json", "enabledByDefault": true }],
    "hooks": [{ "id": "review", "event": "permission.resolved", "skill": "workflow", "enabledByDefault": true }]
  },
  "permissions": [
    {
      "capability": "network.connect",
      "resource": "https://example.com/mcp",
      "access": "connect",
      "required": true,
      "description": "Connect to the Example MCP server"
    },
    {
      "capability": "agent.invoke",
      "resource": "permission.resolved",
      "access": "execute",
      "required": false,
      "description": "Run the workflow Skill after a permission decision"
    }
  ]
}
```

`mcp_stdio` 描述文件使用 `{ "schemaVersion": 1, "command": "...", "args": [], "cwd": "." }`；它要求完全匹配且已允许的 `process.execute / execute / <command>` 权限。`mcp_http` 使用 `{ "schemaVersion": 1, "url": "https://..." }`；它要求 `network.connect / connect / <url>`。明文 HTTP 只允许回环地址。

## 安装与回滚

安装分为 inspect preview 和 commit。preview 绑定调用方、十五分钟过期且只能消费一次。commit 在同一文件系统 staging 中重新校验并原子 rename 到：

```text
Data/plugins/store/<plugin-id>/<version>/<sha256-revision>/
```

版本目录不可变。安装新版本不必切换活动版本；`plugin.activate` 显式选择版本和 revision，因此回滚与升级走同一条路径。SQLite 的 `plugins` 保存活动指针，`plugin_versions` 保存不可变安装记录。事件广播仍遵循 Server 的“先持久化、后广播”规则。

## 信任与权限

`checksums.json` 防止内容漂移；`signature.json` 使用 Ed25519 对完整性聚合摘要签名：

```json
{ "keyId": "release", "algorithm": "ed25519", "signature": "<base64>" }
```

受信公钥位于 `Data/plugins/trust/<keyId>.pub`，内容是 32 字节 Ed25519 公钥的 Base64。生产安装要求受信签名。开发安装会明确标记为 `unsigned` 或 `unknown_key:<id>`，不会伪装成已验证。

Manifest 权限只是请求，不是授权。决定写入 `plugin_permission_grants`，并绑定活动 revision；升级和回滚都不会继承旧授权。缺少必需允许决定时，包可以保持已安装，但所有 Skill、Worker 和 MCP 组件都会被移除且插件自动禁用。插件内 Native Worker 只收到外层 Plugin 已声明且用户允许的权限。

## 运行时

- Skill：作为 `scope=plugin` 的独立 catalog overlay 原子发布，工作区刷新不会将其误删。
- Native Worker：复用 Connector Protocol v1 和独立进程；启动时清空继承环境，只注入协议运行所需值、已审批凭据和少量平台路径。插件 overlay 做所有权、碰撞与权限过滤。Native Worker 属于必须由签名和用户信任覆盖的本机代码边界，独立进程本身不等于内核级沙箱。
- MCP：使用 Rust MCP SDK；启用时握手并分页读取 tools，注册为 `mcp__<plugin>__<component>__<tool>` 动态工具；升级、停用和卸载会取消旧连接。stdio 无 OS 沙箱时不注册，HTTP 受 URL 和权限双重限制。
- UI：`ui_component` 只能引用严格 JSON 文档。宿主在 `plugin_detail` 或 `settings` 贡献点渲染有数量、长度和 tone 白名单限制的静态卡片；不加载 HTML、CSS 或插件 JavaScript。
- Hook：Hook 只能监听宿主白名单中的持久化会话事件，并触发同一插件内已安装的 Skill。启用前必须审批与事件精确匹配的 `agent.invoke / execute` 权限；执行通过幂等 durable job 调度，事件数据始终按不可信输入处理，不执行任意回调代码。

## 控制面

Rust API 类型和生成 TypeScript 客户端是唯一协议事实来源。现有 RPC：

- `plugin.list`、`plugin.read`
- `plugin.inspect`、`plugin.install_preview`
- `plugin.enable`、`plugin.activate`、`plugin.uninstall`
- `plugin.permissions.set`
- `plugin.market.source.list/add/remove/refresh`
- `plugin.market.list`、`plugin.market.inspect`

Web 的“插件管理”页面只通过这些 JSON-RPC 方法工作，可查看版本/信任状态、逐项审批权限、启停和卸载，也可管理签名市场来源、刷新索引、查看撤销状态并下载审查版本。UI 贡献由同一页面的宿主组件渲染。

## 签名市场

市场来源绑定一个 HTTPS 索引 URL 和信任库中的 Ed25519 `keyId`。索引签名、有效期、插件 ID、版本、包 revision、下载 URL 与 SHA-256 都会在进入缓存前校验；HTTP 仅允许带显式端口的回环测试地址，且客户端禁止重定向，防止 HTTPS 降级或目标绕过。

下载包限制为 72 MiB 压缩、64 MiB 解压和 520 个 ZIP 条目，拒绝绝对路径、逃逸路径、重复路径和符号链接。市场包即使调用方关闭 `requireVerified` 也始终按生产策略重新验证。索引缓存和撤销清单在同一 SQLite 事务提交；Server 启动后会立即刷新全部已启用来源，此后每 6 小时刷新一次。刷新发现活动版本被撤销时立即停用，后续安装、启用和版本切换也会再次查询持久撤销记录。网络失败只记录来源错误并保留上一份已验证快照，不会用不完整数据覆盖缓存。

## 迁移策略

旧 Skill 根和独立 Connector package 继续作为兼容输入，统一 Plugin overlay 不会破坏它们；新的第三方能力必须使用 Plugin。Lichess、OpenTTD 和 Victoria 3 已与 HOI4 一样迁移到 `Connectors/official/<id>` 下的 Connector Protocol v1 Worker 包，Server 的启动、动作和查询路径只经过 Worker 协议，不再选择游戏专用运行时分支。

每个官方连接器目录同时包含 `plugin.json` 和 `connector.json`：同一份制品既可作为统一 Plugin 安装，也能作为独立 Connector package 兼容旧部署。开发环境先运行 `npm run build:connectors && npm run package:connectors`，把当前平台 Worker、资产和完整性清单原子发布到 `Data/connectors/packages`。发行流水线对同一包增加签名；作为 Plugin 的 Native Worker 安装时还会叠加 revision 级外层权限审批。连接器身份凭据由通用的 `environment.read` 权限注入，Worker 不继承宿主完整环境。

## 当前安全边界

包拒绝绝对路径、`..`、符号链接、未知字段、重复组件 ID、未声明文件，以及超过 512 文件或 64 MiB 的内容。可执行扩展只能是经过 revision 级准入和权限审批的 Native Worker 或 MCP；UI 和 Hook 均为宿主解释的声明式数据。远程安装只接受签名索引、摘要钉扎、受信包签名和未撤销 revision。需要运行不受信任的第三方进程时应使用 `mcp_stdio`，它在缺少 OS 沙箱时故障关闭；Native Worker 只用于受信发布者的本机集成。
