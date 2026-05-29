import { moncoreRequest } from "./client"
import type { MoncoreCharacter, MoncoreID } from "./types"

export async function getCharacter(characterID: MoncoreID) {
  return moncoreRequest<MoncoreCharacter>(`api/characters/${characterID}/`)
}

