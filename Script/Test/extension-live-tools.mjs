import path from 'node:path'
import { readFile } from 'node:fs/promises'

export const liveExtensionTools = ['list_skills', 'load_skill', 'unload_skill', 'read_skill_file',
  'list_tools', 'load_tools', 'unload_tools', 'read_file', 'write_file', 'edit_file', 'list_directory', 'search_files', 'manage_ui_plugins']

/** Restricts only this disposable test host; never changes production policy or installs an OS sandbox. */
export function constrainExtensionAuthor(host, workspace, pluginId) {
  const allowed = new Set(liveExtensionTools), original = host.sessions.tools.bind(host.sessions)
  function local(requested = '.') {
    const resolved = path.resolve(workspace, requested), relative = path.relative(workspace, resolved)
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('验收只允许访问当前临时工作区')
    return resolved
  }
  async function guard(name, input) {
    if (!allowed.has(name)) throw new Error('验收未开放此工具：' + name)
    if (['read_file', 'write_file', 'edit_file', 'list_directory', 'search_files'].includes(name)) local(input.path)
    if (name === 'load_tools' && input.tools?.some(item => !allowed.has(item.id.replace(/^builtin:/, '')))) throw new Error('验收只允许加载已开放的工具')
    if (name !== 'manage_ui_plugins') return
    if (input.id && input.id !== pluginId) throw new Error('验收只允许管理当前测试插件')
    if (!['inspect', 'install', 'enable'].includes(input.action)) return
    const directory = input.action === 'inspect' ? local(input.path) : path.join(workspace, 'package')
    const manifest = JSON.parse(await readFile(path.join(directory, 'plugin.json'), 'utf8'))
    if (manifest.id !== pluginId || manifest.components?.runtimes?.length || manifest.permissions?.length || manifest.components?.hooks?.length)
      throw new Error('本次验收仅允许当前 API 2 界面组件，不开放后台进程、外部权限或 hooks')
    for (const ui of manifest.components?.ui ?? []) {
      const document = JSON.parse(await readFile(local(path.relative(workspace, path.join(directory, ui.entry))), 'utf8'))
      if (document.capabilities?.tools?.length || document.capabilities?.sessionSend || document.capabilities?.documents)
        throw new Error('本次待办验收不需要工具、消息发送或文档能力')
    }
  }
  function wrap(tool) {
    return { ...tool,
      execute: async (input, context) => {
        await guard(tool.name, input)
        const value = await tool.execute(input, context)
        if (tool.name !== 'list_tools') return value
        return { ...value, tools: value.tools.filter(item => allowed.has(item.name)), nextOffset: null,
          total: value.tools.filter(item => allowed.has(item.name)).length }
      },
      resolveCall: input => {
        const result = tool.resolveCall ? tool.resolveCall(input) : { tool, input }
        if (!allowed.has(result.tool.name)) throw new Error('验收未开放此工具：' + result.tool.name)
        return { ...result, tool: { ...result.tool, execute: async (value, context) => {
          await guard(result.tool.name, value)
          const output = await result.tool.execute(value, context)
          if (result.tool.name !== 'list_tools') return output
          const tools = output.tools.filter(item => allowed.has(item.name))
          return { ...output, tools, nextOffset: null, total: tools.length }
        } } }
      },
    }
  }
  host.sessions.tools = (...args) => original(...args).filter(tool => allowed.has(tool.name)).map(wrap)
  return { tools: liveExtensionTools, scope: 'temporary authoring session only' }
}
