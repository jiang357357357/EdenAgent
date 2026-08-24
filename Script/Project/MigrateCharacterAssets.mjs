#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const agentRoot = path.resolve(scriptDirectory, "../..")
const assetRoot = path.resolve(process.argv[2] || path.join(agentRoot, "../AgentAssets"))
const aronaRoot = path.join(assetRoot, "characters", "arona")
const configPath = path.join(agentRoot, "Data", "local-runtime.json")

const assets = {
  avatar: path.join(aronaRoot, "avatar.png"),
  standing: path.join(aronaRoot, "standing.png"),
  skeleton: path.join(aronaRoot, "spine", "arona_spr.skel"),
  atlas: path.join(aronaRoot, "spine", "arona_spr.atlas"),
  texture: path.join(aronaRoot, "spine", "arona_spr.png"),
}

for (const [kind, assetPath] of Object.entries(assets)) {
  if (!fs.existsSync(assetPath)) {
    throw new Error(`缺少 ${kind} 资源：${assetPath}`)
  }
}

if (!fs.existsSync(configPath)) {
  console.log(`未找到本地运行配置，无需迁移：${configPath}`)
  process.exit(0)
}

const stored = JSON.parse(fs.readFileSync(configPath, "utf8"))
const character = stored.character && typeof stored.character === "object" ? stored.character : {}
const legacyPrefix = "./characters/arona/"
const hasLegacyPath = (value) => typeof value === "string"
  && value.replaceAll("\\", "/").startsWith(legacyPrefix)
const legacySpine = character.spine && (
  hasLegacyPath(character.spine.directory)
  || hasLegacyPath(character.spine.skeletonPath)
  || hasLegacyPath(character.spine.atlasPath)
  || character.spine.textures?.some((texture) => hasLegacyPath(texture.filePath))
)

if (!hasLegacyPath(character.avatarPath) && !hasLegacyPath(character.standingImagePath) && !legacySpine) {
  console.log(`本地角色配置无需迁移：${configPath}`)
  process.exit(0)
}

stored.character = {
  ...character,
  ...(hasLegacyPath(character.avatarPath) ? { avatarPath: assets.avatar } : {}),
  ...(hasLegacyPath(character.standingImagePath) ? { standingImagePath: assets.standing } : {}),
  ...(legacySpine ? {
    visualPreference: "spine",
    spine: {
      ...character.spine,
      directory: path.dirname(assets.skeleton),
      skeletonPath: assets.skeleton,
      atlasPath: assets.atlas,
      textures: [{ pageName: "arona_spr.png", filePath: assets.texture }],
    },
  } : {}),
}

const temporaryPath = `${configPath}.assets-migration-${process.pid}`
const mode = fs.statSync(configPath).mode & 0o777
fs.writeFileSync(temporaryPath, `${JSON.stringify(stored, null, 2)}\n`, { mode })
fs.renameSync(temporaryPath, configPath)
console.log(`已将本地角色视觉资源切换到：${aronaRoot}`)
