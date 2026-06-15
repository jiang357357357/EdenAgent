export function formatLocalTime(value?: Date | number | string | null) {
  if (value === undefined || value === null || value === "") return ""
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return ""
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function formatLocalDateTime(value?: Date | number | string | null) {
  if (value === undefined || value === null || value === "") return "-"
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return "-"
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)
}

export function formatLocalMonthDayTime(value?: Date | number | string | null) {
  if (value === undefined || value === null || value === "") return "-"
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return "-"
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)
}

export function formatLocalWeekday(value?: Date | number | string | null) {
  if (value === undefined || value === null || value === "") return "-"
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return "-"
  return new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(date)
}

export function toDateTimeLocalInputValue(value?: string | null) {
  if (!value) return ""
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ""
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return offsetDate.toISOString().slice(0, 16)
}

export function fromDateTimeLocalInputValue(value: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}
