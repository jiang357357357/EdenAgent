import sessionProjectors, { initMoncoreSync } from "../session/projectors"
import { SyncEvent } from "@/sync"

export function initProjectors() {
  SyncEvent.init({ projectors: sessionProjectors })
  initMoncoreSync()
}

initProjectors()
