import { z } from 'zod'

const text = (max: number) => z.string().trim().min(1).max(max)
export const stickerListInputSchema = z.object({ query: z.string().trim().max(200).default('') }).strict()
export const stickerSelectInputSchema = z.object({ sticker: text(200) }).strict()
export const stickerRememberInputSchema = z.object({
  name: text(64), description: text(2000), emotion: text(64), intent: text(64),
  aliases: z.array(text(200)).min(1).max(30),
  blobId: z.uuid().optional(), imageUrl: z.string().url().max(8192).optional(),
}).strict().refine(value => Number(Boolean(value.blobId)) + Number(Boolean(value.imageUrl)) === 1,
  'Choose exactly one image source: blobId or imageUrl')

export const characterStickerSchema = z.object({
  id: z.number().int().positive(), character_id: z.number().int().positive(), name: text(200),
  aliases: z.array(z.string()), description: z.string(), emotion: z.string(), intent: z.string(),
  image_url: z.string().url(), enabled: z.boolean().default(true),
})
export type CharacterSticker = z.infer<typeof characterStickerSchema>
export const STICKER_MAX_BYTES = 10 * 1024 * 1024
