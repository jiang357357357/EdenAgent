param(
  [switch]$Release,
  [ValidateSet("mon", "local")]
  [string]$RuntimeOrigin = "mon"
)
$ErrorActionPreference = "Stop"
$agentRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..")
Set-Location -LiteralPath $agentRoot.Path
$env:EDEN_AGENT_RUNTIME_ORIGIN = $RuntimeOrigin
if ($Release) {
  & npm run build:server
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & node Script/Project/start_server.mjs --built
} else {
  & node Script/Project/start_server.mjs
}
exit $LASTEXITCODE
