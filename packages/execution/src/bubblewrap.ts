// Legacy API compatibility only; archived sandbox implementation requires developer review.
import { sandboxReviewNotice } from './execution-policy.ts'
export { runHostModule as runIsolatedModule } from './host-module.ts'
export type { HostModuleRequest as IsolatedModuleRequest } from './host-module.ts'
export async function probeSandbox() {
  return { available: false, backend: 'disabled', detail: sandboxReviewNotice }
}
