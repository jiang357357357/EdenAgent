import { z } from 'zod'
import { pluginManifestSchema } from '@eden/plugin-sdk'
import { toJson } from '@eden/api'

export function pluginGuide() {
  return toJson({
    manifestExample: {
      schemaVersion: 1, id: 'text-length', name: '文本长度', description: '返回所提供文本的 UTF-16 长度。',
      version: '0.1.0', entry: 'index.ts', permissions: [],
      tool: { name: 'text_length', description: '计算文本包含的 UTF-16 代码单元数量。', parameters: {
        type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false,
      } },
      tests: [{ input: { text: 'hello' }, expected: { length: 5 } }],
    },
    manifestSchema: z.toJSONSchema(pluginManifestSchema),
    sourceExample: 'export default function(input: { text: string }) { return { length: input.text.length }; }',
    handler: '默认导出函数接收 (input, context)，返回 JSON 或 Promise<JSON>。context.workspaceRoot 是宿主绝对路径。',
    dependencies: '源码入口为单个 index.ts，可显式导入 node: 内置模块；其他依赖直接包含在源码实现中。',
    schema: '参数使用 JSON Schema：type、description、properties、required、additionalProperties:false、items、enum；结构深度上限为 12，每个对象声明 properties 和 additionalProperties:false。',
    limits: '源码最大 64 KiB，测试用例最多 20 个，执行限时 5 秒，输出最大 1 MiB。文件、网络和进程访问使用当前操作系统账户权限；沙箱已暂停，等待开发者审阅。',
    workflow: '编辑现有草稿前先调用 read(id)，宿主自动记录读取快照，draft 只传 manifest/source，validate/test 只传 id。并发修改后需重新读取再编辑或测试。流程为 draft → validate → test → 安装精确测试版本 → 必要时由用户授予工作区权限 → activate → 调用已激活插件；激活以前安装的版本即可回滚。智能体使用 manage_plugins 的 invoke 时只传 id 和 input，由宿主解析并锁定已激活版本。',
  })
}
