import { moncoreRequest } from "./client"
import type { MoncoreOpencodeSettings } from "./types"

export async function getMyOpencodeSettings() {
  return moncoreRequest<MoncoreOpencodeSettings>("api/opencode/settings/my/")
}

