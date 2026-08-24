param([switch]$Release)

$ErrorActionPreference = "Stop"

$agentRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..")
Set-Location -LiteralPath $agentRoot.Path

# Keep direct/MonPM-style server launches aligned with the desktop
# configuration page. Values are applied only to this server process.
$runtimeEnvironmentJson = & node (Join-Path $agentRoot.Path "Script\Project\local_runtime_environment.cjs") --json $agentRoot.Path
if ($LASTEXITCODE -ne 0) {
  throw "Failed to load the local runtime configuration."
}
$runtimeEnvironment = $runtimeEnvironmentJson | ConvertFrom-Json
foreach ($property in $runtimeEnvironment.PSObject.Properties) {
  [Environment]::SetEnvironmentVariable($property.Name, [string]$property.Value, "Process")
}

if ($Release) {
  & cargo run --release -p mon-agent-server
} else {
  & cargo run -p mon-agent-server
}
exit $LASTEXITCODE
