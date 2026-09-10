/** 沙箱已按用户要求暂停；必须经开发者审阅后才能重新加入。无运行时启用开关。 */
export const executionPolicy = Object.freeze({ mode: 'host' as const, sandboxEnabled: false })
export const sandboxReviewNotice = '沙箱机制已暂停，需开发者审阅后才能重新加入。'
export async function probeHostExecution() {
  return { available: true, backend: 'host', detail: '使用当前系统账户执行，文件和网络访问遵循本机权限。' }
}
