param(
  [switch]$Release,
  [ValidateSet("mon", "local")]
  [string]$RuntimeOrigin = "mon"
)

$ErrorActionPreference = "Stop"

$agentRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..")
Set-Location -LiteralPath $agentRoot.Path

$realmRoot = Join-Path $agentRoot.Path "Data\realms\$RuntimeOrigin"
New-Item -ItemType Directory -Path $realmRoot -Force | Out-Null
$legacyDatabase = Join-Path $agentRoot.Path "Data\eden-agent.db"
$realmDatabase = Join-Path $realmRoot "eden-agent.db"
if ((Test-Path -LiteralPath $legacyDatabase) -and -not (Test-Path -LiteralPath $realmDatabase)) {
  Copy-Item -LiteralPath $legacyDatabase -Destination $realmDatabase
  foreach ($suffix in @("-wal", "-shm")) {
    $source = "$legacyDatabase$suffix"
    if (Test-Path -LiteralPath $source) {
      Copy-Item -LiteralPath $source -Destination "$realmDatabase$suffix"
    }
  }
}
foreach ($directory in @("blobs", "plugins", "skills", "connectors", "agents")) {
  $source = Join-Path $agentRoot.Path "Data\$directory"
  $target = Join-Path $realmRoot $directory
  if ((Test-Path -LiteralPath $source) -and -not (Test-Path -LiteralPath $target)) {
    Copy-Item -LiteralPath $source -Destination $target -Recurse
  }
}
if ($RuntimeOrigin -eq "local") {
  $legacyRuntimeConfig = Join-Path $agentRoot.Path "Data\local-runtime.json"
  $realmRuntimeConfig = Join-Path $realmRoot "local-runtime.json"
  if ((Test-Path -LiteralPath $legacyRuntimeConfig) -and -not (Test-Path -LiteralPath $realmRuntimeConfig)) {
    Copy-Item -LiteralPath $legacyRuntimeConfig -Destination $realmRuntimeConfig
  }
}
if ((Test-Path -LiteralPath $legacyDatabase) -and -not (Test-Path -LiteralPath (Join-Path $realmRoot ".realm-migration-complete"))) {
  Set-Content -LiteralPath (Join-Path $realmRoot ".realm-migration-pending") -Value $RuntimeOrigin -NoNewline
}

$defaultPort = if ($RuntimeOrigin -eq "local") { "40093" } else { "40092" }
$port = if ($env:EDEN_AGENT_PORT) { $env:EDEN_AGENT_PORT } else { $defaultPort }
$env:EDEN_AGENT_RUNTIME_ORIGIN = $RuntimeOrigin
if (-not $env:EDEN_AGENT_BIND) { $env:EDEN_AGENT_BIND = "127.0.0.1:$port" }
$env:EDEN_AGENT_DATABASE = $realmDatabase
$env:EDEN_AGENT_BLOB_ROOT = Join-Path $realmRoot "blobs"
$env:EDEN_AGENT_LOG_DIRECTORY = Join-Path $realmRoot "logs"
$env:EDEN_AGENT_PLUGIN_ROOT = Join-Path $realmRoot "plugins"
$env:EDEN_AGENT_SKILL_INSTALL_ROOT = Join-Path $realmRoot "skills"
$env:EDEN_AGENT_CONNECTOR_PACKAGE_ROOT = Join-Path $realmRoot "connectors\packages"
$env:EDEN_AGENT_CONNECTOR_DATA_ROOT = Join-Path $realmRoot "connectors\runtime"
$env:EDEN_AGENT_USER_AGENT_ROOT = Join-Path $realmRoot "agents"
$env:EDEN_AGENT_TOKEN_FILE = Join-Path $realmRoot "capability.token"
$env:EDEN_AGENT_REALM_MIGRATION_MARKER = Join-Path $realmRoot ".realm-migration-pending"

$runtimeLoader = Join-Path $agentRoot.Path "Script\Project\local_runtime_environment.cjs"
if ($RuntimeOrigin -eq "local") {
  $runtimeEnvironmentJson = & node $runtimeLoader --json $agentRoot.Path
  if ($LASTEXITCODE -ne 0) { throw "Failed to load the local runtime configuration." }
  $runtimeEnvironment = $runtimeEnvironmentJson | ConvertFrom-Json
  foreach ($property in $runtimeEnvironment.PSObject.Properties) {
    [Environment]::SetEnvironmentVariable($property.Name, [string]$property.Value, "Process")
  }
  Remove-Item Env:MON_CORE_BASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:MON_CORE_TOKEN -ErrorAction SilentlyContinue
  $env:EDEN_AGENT_LEGACY_CORE_DATABASE = Join-Path $realmRoot "no-legacy-core.db"
} else {
  $runtimeKeys = & node $runtimeLoader --keys $agentRoot.Path
  if ($LASTEXITCODE -ne 0) { throw "Failed to identify local runtime variables." }
  foreach ($runtimeKey in $runtimeKeys) {
    if ($runtimeKey) { [Environment]::SetEnvironmentVariable($runtimeKey, $null, "Process") }
  }
  Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:OPENAI_BASE_URL -ErrorAction SilentlyContinue
}

if ($Release) {
  & cargo run --release -p eden-agent-server
} else {
  & cargo run -p eden-agent-server
}
exit $LASTEXITCODE
