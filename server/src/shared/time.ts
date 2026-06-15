export function localTimeZoneLabel() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "本地时区"
}

export function localUtcOffsetLabel(date = new Date()) {
  const offsetMinutes = -date.getTimezoneOffset()
  const offsetHours = Math.trunc(offsetMinutes / 60)
  const offsetRemainder = Math.abs(offsetMinutes % 60)
  return `UTC${offsetMinutes >= 0 ? "+" : "-"}${String(Math.abs(offsetHours)).padStart(2, "0")}:${String(offsetRemainder).padStart(2, "0")}`
}

export function toStorageIso(value: Date | number | string) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`无法解析时间: ${String(value)}`)
  }
  return date.toISOString()
}

export function formatLocalDateTime(value?: Date | number | string | null, options?: { seconds?: boolean; weekday?: boolean }) {
  if (value === undefined || value === null || value === "") return "-"
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return String(value)
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(options?.weekday ? { weekday: "long" as const } : {}),
    hour: "2-digit",
    minute: "2-digit",
    ...(options?.seconds ? { second: "2-digit" as const } : {}),
    hour12: false,
  }).format(date)
}

export function formatLocalDateTimeWithZone(value?: Date | number | string | null) {
  const formatted = formatLocalDateTime(value)
  return formatted === "-" ? formatted : `${formatted}（${localTimeZoneLabel()}）`
}
