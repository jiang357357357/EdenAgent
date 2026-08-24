const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const { bashExports, createLocalRuntimeEnvironment } = require("./local_runtime_environment.cjs")

test("loads the desktop runtime configuration for an external server", () => {
  const agentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mon-agent-runtime-"))
  try {
    fs.mkdirSync(path.join(agentRoot, "Data"), { recursive: true })
    fs.writeFileSync(path.join(agentRoot, "Data", "local-runtime.json"), JSON.stringify({
      version: 5,
      provider: "deepseek",
      model: "deepseek/deepseek-chat",
      baseUrl: "https://api.deepseek.test/v1",
      apiKey: "test-key",
      contextWindow: 64000,
      maxOutputTokens: 8000,
      supportsImages: false,
      timeoutSeconds: 60,
      maxRetries: 1,
    }))

    const environment = createLocalRuntimeEnvironment(agentRoot, {})
    assert.equal(environment.MON_AGENT_MODEL, "deepseek/deepseek-chat")
    assert.equal(environment.MON_AGENT_BASE_URL, "https://api.deepseek.test/v1")
    assert.equal(environment.DEEPSEEK_API_KEY, "test-key")
    assert.equal(environment.MON_AGENT_MODEL_SUPPORTS_IMAGES, "false")
  } finally {
    fs.rmSync(agentRoot, { recursive: true, force: true })
  }
})

test("quotes shell values without allowing command substitution", () => {
  const exports = bashExports({ MON_AGENT_MODEL: "custom/model", CUSTOM_API_KEY: "a'b$(touch nope)" })
  assert.match(exports, /export MON_AGENT_MODEL='custom\/model'/)
  assert.match(exports, /export CUSTOM_API_KEY='a'\\''b\$\(touch nope\)'/)
})
