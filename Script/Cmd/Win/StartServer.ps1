param(
  [string]$Python
)

$ErrorActionPreference = "Stop"

$agentRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..")
$serverRoot = Join-Path $agentRoot.Path "Server"
$venvPython = Join-Path $serverRoot ".venv\Scripts\python.exe"
$pythonBin = if ($Python) {
  $Python
} elseif ($env:MON_AGENT_PYTHON) {
  $env:MON_AGENT_PYTHON
} elseif ($env:PYTHON) {
  $env:PYTHON
} else {
  $null
}

$paths = @(
  (Join-Path $agentRoot.Path "Server\src")
)
if ($env:PYTHONPATH) {
  $paths += $env:PYTHONPATH
}
$env:PYTHONPATH = [string]::Join([IO.Path]::PathSeparator, $paths)

Set-Location -LiteralPath $agentRoot.Path
if ($pythonBin) {
  & $pythonBin -m mon_agent_server
} elseif (Get-Command "uv" -ErrorAction SilentlyContinue) {
  & uv run --project $serverRoot --locked python -m mon_agent_server
} elseif (Test-Path $venvPython) {
  & $venvPython -m mon_agent_server
} else {
  & python -m mon_agent_server
}
exit $LASTEXITCODE
