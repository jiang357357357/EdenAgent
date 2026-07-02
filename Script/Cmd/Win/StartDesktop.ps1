$ErrorActionPreference = "Stop"

$agentRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..")
Set-Location -LiteralPath $agentRoot.Path

bun run Script/Project/dev-desktop.ts
exit $LASTEXITCODE
