param([switch]$Release)

$ErrorActionPreference = "Stop"

$agentRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..")
Set-Location -LiteralPath $agentRoot.Path
if ($Release) {
  & cargo run --release -p mon-agent-server
} else {
  & cargo run -p mon-agent-server
}
exit $LASTEXITCODE
