import { z } from 'zod'
import { blobInfoSchema } from './blobs.ts'
export const packageAssetListSchema = z.object({ id: z.string().min(1).max(128), revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
export const packageAssetExportSchema = packageAssetListSchema.extend({ source: z.string().min(1).max(1024) })
export const packageAssetInfoSchema = z.object({ source: z.string(), targetKind: z.string(), target: z.string(), byteLength: z.number(), sha256: z.string() })
export const packageAssetExportResultSchema = z.object({ source: z.string(), targetKind: z.string(), target: z.string(), blob: blobInfoSchema })
export type PackageAssetInfo = z.infer<typeof packageAssetInfoSchema>
export type PackageAssetExport = z.infer<typeof packageAssetExportResultSchema>
