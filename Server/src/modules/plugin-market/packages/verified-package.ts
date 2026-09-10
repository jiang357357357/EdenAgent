import type { z } from 'zod'
import type { packageManifestSchema } from './manifest.ts'

export interface VerifiedPackage {
  manifest: z.infer<typeof packageManifestSchema>
  revision: string
  files: Map<string, Buffer>
}
