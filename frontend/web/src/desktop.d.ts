export {}

declare global {
  interface Window {
    monAgentDesktop?: {
      invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>
      onViewMode?(callback: (mode: "chatWithCharacter" | "character") => void): () => void
      onPetSettings?(callback: (settings: Record<string, unknown>) => void): () => void
      onOpenSettings?(callback: () => void): () => void
      convertFileSrc?(filePath: string): string
    }
  }
}
