import type { RuntimeTool } from './contracts.ts'

/** Execution authority comes from registration; exposure only controls model context. */
export function modelTools(tools: RuntimeTool[]): RuntimeTool[] {
  return tools.filter(tool => tool.exposure === undefined || tool.exposure === 'direct')
}
