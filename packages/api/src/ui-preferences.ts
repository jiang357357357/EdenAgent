import { z } from "zod"
export const replyLengthSchema = z.enum(["short", "medium", "long"])
const replyCharacter = z.object({ characterId: z.string().trim().min(1).max(100) }).strict()
const replyLength = z.object({ length: replyLengthSchema }).strict()
const preferences = z.object({ autoScrollEnabled: z.boolean() }).strict()
const background = z
  .object({
    opacity: z.number().min(0).max(100),
    blur: z.number().min(0).max(30),
    imageBlobId: z.uuid().nullable().default(null),
  })
  .strict()
export const baseThemeSchema = z.enum(["night", "cream", "peach", "sage", "lavender"])
export type BaseTheme = z.infer<typeof baseThemeSchema>
export const accentThemeSchema = z.enum(["mist", "blue", "mint", "rose", "amber"])
export type AccentTheme = z.infer<typeof accentThemeSchema>
const appearance = z
  .object({
    baseTheme: baseThemeSchema.default("night"),
    backgroundMode: z.enum(["theme", "wallpaper"]).default("wallpaper"),
    accentTheme: accentThemeSchema.default("mist"),
    chatFontScale: z.number().int().min(80).max(140),
    componentFontScale: z.number().int().min(80).max(140),
  })
  .strict()
export const uiPreferenceRpcMethods = {
  "ui.reply_length.get": { params: replyCharacter, result: replyLength },
  "ui.reply_length.update": { params: replyCharacter.extend({ length: replyLengthSchema }), result: replyLength },
  "ui.appearance.get": { params: z.object({}).strict(), result: appearance },
  "ui.appearance.update": { params: appearance, result: appearance },
  "ui.background.get": { params: z.object({}).strict(), result: background },
  "ui.background.update": { params: background, result: background },
  "ui.preferences.get": { params: z.object({}).strict(), result: preferences },
  "ui.preferences.update": { params: preferences, result: preferences },
} as const
