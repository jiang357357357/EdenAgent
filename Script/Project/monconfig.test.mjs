import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { loadMonConfig } from "./monconfig.mjs"

test("loads only the nearest module config and finds the dual-anchor workspace", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "monconfig-"))
  try {
    writeFileSync(path.join(workspace, ".monworkspace"), "modules: []\n")
    writeFileSync(path.join(workspace, ".monconfig"), "[server]\nPORT=1\n")
    const moduleRoot = path.join(workspace, "Agent")
    const nested = path.join(moduleRoot, "Script", "Project")
    mkdirSync(nested, { recursive: true })
    writeFileSync(
      path.join(moduleRoot, ".monconfig"),
      "[Server]\nport=40092\nURL=https://example.test/#fragment # comment\n",
    )

    const config = loadMonConfig(nested)
    assert.equal(config.get("SERVER", "port"), "40092")
    assert.equal(config.get("server", "URL"), "https://example.test/#fragment")
    assert.equal(config.moduleRoot, moduleRoot)
    assert.equal(config.workspaceRoot, workspace)
    assert.deepEqual(config.files, [path.join(moduleRoot, ".monconfig")])
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test("rejects malformed and invalid numeric values", () => {
  const moduleRoot = mkdtempSync(path.join(os.tmpdir(), "monconfig-"))
  try {
    writeFileSync(path.join(moduleRoot, ".monconfig"), "[test]\nCOUNT=many\n")
    const config = loadMonConfig(moduleRoot)
    assert.throws(() => config.number("test", "COUNT", 1), /must be an integer/)
    writeFileSync(path.join(moduleRoot, ".monconfig"), "[test]\nBROKEN\n")
    assert.throws(() => loadMonConfig(moduleRoot), /expected KEY=VALUE/)
  } finally {
    rmSync(moduleRoot, { recursive: true, force: true })
  }
})
