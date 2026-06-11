export {}

declare global {
  interface Window {
    monAgentDesktop?: {
      invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>
      onViewMode?(callback: (mode: "chatWithCharacter" | "character") => void): () => void
      convertFileSrc?(filePath: string): string
    }
  }
}
