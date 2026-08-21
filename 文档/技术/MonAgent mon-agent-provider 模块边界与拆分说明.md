# MonAgent mon-agent-provider 模块边界与拆分说明

## 定位

`mon-agent-provider` 是 Server 内的模型供应商适配层。它实现 AgentCore 的
`ModelAdapter`，负责把宿主无关的 `ModelRequest` 转换为供应商协议，并把 HTTP/SSE
响应还原为 AgentCore 的 `ModelOutput` 和流式事件。

它不负责 Agent 循环、会话持久化、上下文压缩、JSON-RPC 或前端显示。

## 依赖方向

```text
mon-agent-app / mon-agent-server
              |
              v
   DynamicModelProvider <---- CoreModelClient
              |                  |
              |          ResolvedModelBinding
              v                  |
   OpenAiCompatibleProvider <----+
              |
              v
     OpenAI-compatible HTTP/SSE
```

- `CoreModelClient` 是 Mon Core JSON 的唯一解释者。
- `ResolvedModelBinding` 是 Core 配置层与动态路由之间的强类型内部契约。
- `DynamicModelProvider` 只管理默认、会话、助手和视觉模型绑定，不解析
  `ai_model`、`api_key`、`api_endpoint` 等 Core 原始字段。
- API Key 只存在于进程内绑定和 Provider 配置中，不进入 `runtime_info`。

## 文件结构

```text
src/
├── lib.rs                    # crate 门面和稳定公开导出
├── binding.rs                # ResolvedModelBinding 内部契约
├── config.rs                 # 环境变量和 OpenAI 兼容配置
├── dynamic.rs                # 动态模型路由、快照和视觉回退
├── support.rs                # 小型无状态辅助函数
├── unavailable.rs            # 故障关闭 Provider
├── core_client/
│   ├── mod.rs                # CoreModelClient 门面
│   ├── catalog.rs            # Core 模型目录和模型选择
│   ├── configuration.rs      # 会话/助手模型配置
│   ├── model.rs              # Core JSON 到强类型绑定的解析
│   └── transport.rs          # Core HTTP、鉴权和错误转换
└── openai/
    ├── mod.rs                # OpenAI 子模块门面
    ├── capabilities.rs       # 供应商族识别与请求能力矩阵
    ├── contract.rs           # 请求发送前的工具协议校验
    ├── provider.rs           # ModelAdapter 主调用和重试编排
    ├── payload.rs            # Chat/Responses 请求载荷
    ├── messages.rs           # 消息、图片和工具结果转换
    ├── speaker.rs            # 多助手名称和前缀过滤
    ├── stream.rs             # SSE、累积器和流式事件
    ├── usage.rs              # Token/缓存用量标准化
    ├── retry.rs              # 预算、重试和取消
    └── tests/
        ├── mod.rs            # 共用测试夹具
        ├── config.rs
        ├── dynamic.rs
        ├── payload.rs
        └── stream.rs
```

## 对外 API

`lib.rs` 只导出 Server 当前需要的稳定类型：

- `CoreModelClient`
- `DynamicModelProvider`
- `ModelAvailability`
- `SessionModelSnapshot`
- `OpenAiCompatibleConfig`
- `OpenAiCompatibleProvider`
- `UnavailableProvider`
- `model_spec_from_env`

内部协议解析器、流累积器、Core DTO 和凭据绑定均不公开。

## 维护规则

1. 新供应商协议放在独立子模块中，不向 AgentCore 泄漏 HTTP 或供应商字段。
2. Core API 字段变化只修改 `core_client/model.rs` 及其测试。
3. 动态路由只能接收已解析的 `ResolvedModelBinding`。
4. 请求发送前必须执行上下文预算和工具协议硬校验。
5. 文本前缀过滤必须发生在事件广播、持久化和语音合成之前。
6. Token 用量必须先标准化，再交给上层持久化和前端。
7. 生产模块使用显式导入；测试子模块可以共享测试夹具。
8. `lib.rs` 不承载实现代码。

## 工具 Schema 长期契约

AgentCore 是工具定义的唯一事实来源。所有直接暴露给模型的工具都必须提供完整的
JSON Schema 对象，最小的无参数工具定义为：

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

不再兼容 `{}`、`null`、非对象根节点或缺少 `properties` 的旧定义；`required` 中的字段
也必须已经在 `properties` 中声明。契约采用三道失败前置：

1. `ToolDefinition::direct` 默认产生严格的无参数对象 Schema。
2. Server 启动时审计全部已注册直接工具，非法定义会阻止服务启动。
3. Provider 每次发送请求前再次校验，动态注入的非法工具返回本地
   `invalid_tool_schema`，不会消耗供应商请求和重试预算。

## 供应商能力矩阵

“OpenAI-compatible”只表示传输协议相近，不表示扩展字段完全相同。Provider 先将
供应商名称归一化，再由 `ProviderCapabilities` 决定载荷：

| 供应商族 | `prompt_cache_key` | `reasoning_effort` | 流式 usage |
| --- | --- | --- | --- |
| OpenAI | 开启 | 开启 | 开启 |
| DeepSeek | 关闭 | 关闭 | 开启 |
| OpenCode Go | 开启 | 开启 | 开启 |
| 通用 OpenAI 兼容端点 | 关闭 | 关闭 | 开启 |

具体模型确实支持扩展字段时，可通过模型 `extra` 中的
`supportsPromptCacheKey`、`supportsReasoningEffort`、`supportsStreamUsage` 显式覆盖；
不得根据模型名称猜测能力，也不得在供应商报错后静默删字段重试。工具 Schema 本身使用
跨供应商严格公共子集，不在 Provider 内做临时修补。

## 增量验证

```powershell
cargo fmt -p mon-agent-provider -- --check
cargo check -p mon-agent-provider
cargo test -p mon-agent-provider
cargo check -p mon-agent-server
```

以上命令均使用 Cargo 增量缓存，不要求全量或发布构建。
