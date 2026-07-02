$ErrorActionPreference = "Stop"

$agentRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..")
Set-Location -LiteralPath $agentRoot.Path

bun run dev:web
exit $LASTEXITCODE
