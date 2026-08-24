param(
  [string]$VictoriaUserRoot = (Join-Path $env:USERPROFILE "Documents\Paradox Interactive\Victoria 3")
)

$ErrorActionPreference = "Stop"

$agentRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..")).Path
$source = Join-Path $agentRoot "Server\connectors\victoria3_bridge\mod"
$modRoot = Join-Path $VictoriaUserRoot "mod"
$target = Join-Path $modRoot "edenagent_victoria3_observer"

if (-not (Test-Path -LiteralPath (Join-Path $source ".metadata\metadata.json"))) {
  throw "Victoria 3 observer source is incomplete: $source"
}

New-Item -ItemType Directory -Path $modRoot -Force | Out-Null

if (Test-Path -LiteralPath $target) {
  $item = Get-Item -LiteralPath $target -Force
  if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw "Refusing to replace an existing non-link mod directory: $target"
  }
  $resolvedTarget = $item.Target
  if ($resolvedTarget -is [array]) {
    $resolvedTarget = $resolvedTarget[0]
  }
  if ($resolvedTarget -and [IO.Path]::GetFullPath($resolvedTarget) -eq [IO.Path]::GetFullPath($source)) {
    Write-Host "Victoria 3 observer bridge is already linked: $target"
    exit 0
  }
  throw "Refusing to replace a link that points somewhere else: $target"
}

New-Item -ItemType Junction -Path $target -Target $source | Out-Null
Write-Host "Installed Victoria 3 observer bridge:"
Write-Host "  Source: $source"
Write-Host "  Mod:    $target"
Write-Host "Enable 'Eden Agent Victoria 3 Observer Bridge' in a Victoria 3 launcher playset."
