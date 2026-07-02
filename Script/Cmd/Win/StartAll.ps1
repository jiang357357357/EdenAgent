param(
  [switch]$Foreground
)

$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "Start.ps1") -Foreground:$Foreground
exit $LASTEXITCODE
