import { z } from 'zod'

const text = z.string().max(500).default('')
export const sessionEnvironmentSchema = z.object({
  timezone: text, locale: text,
  location: z.object({ country: text, region: text, city: text, district: text,
    latitude: z.number().min(-90).max(90).nullish(), longitude: z.number().min(-180).max(180).nullish(),
  }).optional(),
}).nullable()

// Persisted environment may include coordinates; model context uses named places only.
export function modelEnvironment(value: unknown) {
  const parsed = sessionEnvironmentSchema.safeParse(value)
  if (!parsed.success || !parsed.data) return null
  const { timezone, locale, location } = parsed.data
  return { timezone, locale, ...(location ? { location: {
    country: location.country, region: location.region, city: location.city, district: location.district,
  } } : {}) }
}
