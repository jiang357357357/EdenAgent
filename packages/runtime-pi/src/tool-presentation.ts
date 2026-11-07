import type { RuntimeTool } from './contracts.ts'

/** Execution authority comes from registration; exposure only controls model context. */
export function modelTools(tools: RuntimeTool[]): RuntimeTool[] {
  return tools.filter(tool => tool.exposure === undefined || tool.exposure === 'direct').toSorted(toolNameOrder)
}

export function toolNameOrder(left: { name: string }, right: { name: string }): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
}
