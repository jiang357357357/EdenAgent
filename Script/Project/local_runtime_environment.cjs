const path = require("node:path")

const { createLocalRuntimeConfigStore } = require("../../frontend/desktop/src/app/local-runtime-config.cjs")

function createLocalRuntimeEnvironment(agentRoot, processEnvironment = process.env) {
  const resolvedRoot = path.resolve(agentRoot)
  const store = createLocalRuntimeConfigStore({
    app: { isPackaged: false, getPath: () => path.join(resolvedRoot, "Data") },
    agentRoot: resolvedRoot,
  })
  return store.environment(processEnvironment)
}

function quoteForBash(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`
}

function bashExports(environment) {
  return Object.entries(environment).map(([key, value]) => {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) throw new Error(`Invalid environment variable name: ${key}`)
    return `export ${key}=${quoteForBash(value)}`
  }).join("\n")
}

if (require.main === module) {
  const mode = process.argv[2]
  const agentRoot = process.argv[3] || path.resolve(__dirname, "../..")
  const environment = createLocalRuntimeEnvironment(agentRoot)
  if (mode === "--shell") {
    process.stdout.write(`${bashExports(environment)}\n`)
  } else if (mode === "--json") {
    process.stdout.write(JSON.stringify(environment))
  } else {
    throw new Error("Usage: local_runtime_environment.cjs --shell|--json [agent-root]")
  }
}

module.exports = { bashExports, createLocalRuntimeEnvironment, quoteForBash }
