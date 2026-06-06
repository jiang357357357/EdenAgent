const random = () => Math.random().toString(36).slice(2, 10)

export function createID(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${random()}`
}
