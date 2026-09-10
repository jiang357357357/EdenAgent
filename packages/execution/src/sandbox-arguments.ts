import { sandboxReviewNotice } from './execution-policy.ts'
// Intentionally inert. Developer review is required before restoring any sandbox launcher.
export const sandboxExecutable = ''
export function sandboxArguments(): string[] { throw new Error(sandboxReviewNotice) }
