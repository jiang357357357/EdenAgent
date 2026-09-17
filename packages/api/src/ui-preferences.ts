import { z } from "zod"
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
  "ui.appearance.get": { params: z.object({}).strict(), result: appearance },
  "ui.appearance.update": { params: appearance, result: appearance },
  "ui.background.get": { params: z.object({}).strict(), result: background },
  "ui.background.update": { params: background, result: background },
  "ui.preferences.get": { params: z.object({}).strict(), result: preferences },
  "ui.preferences.update": { params: preferences, result: preferences },
} as const
