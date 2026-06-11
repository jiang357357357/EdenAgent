export interface SelfAwakeCharacter {
  name?: string
  description?: string
  signature?: string
}

export interface SelfAwakeRequest {
  character?: SelfAwakeCharacter
  context?: Record<string, unknown>
}

export interface SelfAwakeDecision {
  mood: string
  current_desire: string
  observations?: string[]
  should_interrupt_user: boolean
  action: {
    type: "observe_only" | "write_diary" | "remind_user" | "create_task" | "ask_user" | "run_safe_check" | "sync_context"
    message: string
    payload?: Record<string, unknown>
  }
  next_wake: {
    after_minutes: number
    reason: string
  }
  diary: {
    title: string
    content: string
  }
  source?: "agent" | "fallback"
  error?: string
}
