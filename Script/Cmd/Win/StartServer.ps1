param(
  [string]$Python
)

$ErrorActionPreference = "Stop"

$agentRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..")
$pythonBin = if ($Python) {
  $Python
} elseif ($env:MON_AGENT_PYTHON) {
  $env:MON_AGENT_PYTHON
} elseif ($env:PYTHON) {
  $env:PYTHON
} else {
  "python"
}

$paths = @(
  (Join-Path $agentRoot.Path "Server\src"),
  (Join-Path $agentRoot.Path "AgentCore\src")
)
if ($env:PYTHONPATH) {
  $paths += $env:PYTHONPATH
}
$env:PYTHONPATH = [string]::Join([IO.Path]::PathSeparator, $paths)

Set-Location -LiteralPath $agentRoot.Path
& $pythonBin -m mon_agent_server
exit $LASTEXITCODE
