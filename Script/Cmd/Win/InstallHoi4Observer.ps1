param(
  [string]$Hoi4UserRoot = (Join-Path $env:USERPROFILE "Documents\Paradox Interactive\Hearts of Iron IV")
)

$ErrorActionPreference = "Stop"

$agentRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..")).Path
$source = Join-Path $agentRoot "Connectors\official\hoi4\package\assets\game-mod"
$modRoot = Join-Path $Hoi4UserRoot "mod"
$target = Join-Path $modRoot "monagent_hoi4_observer"
$launcherDescriptor = Join-Path $modRoot "monagent_hoi4_observer.mod"

if (-not (Test-Path -LiteralPath (Join-Path $source "descriptor.mod"))) {
  throw "HOI4 observer source is incomplete: $source"
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
  if (-not $resolvedTarget -or [IO.Path]::GetFullPath($resolvedTarget) -ne [IO.Path]::GetFullPath($source)) {
    throw "Refusing to replace a link that points somewhere else: $target"
  }
} else {
  New-Item -ItemType Junction -Path $target -Target $source | Out-Null
}

$descriptor = @"
version="0.1.0"
tags={
  "Utilities"
}
name="MonAgent Hearts of Iron IV Observer Bridge"
supported_version="1.19.*"
path="$($target.Replace('\', '/'))"
"@
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($launcherDescriptor, $descriptor, $utf8NoBom)

Write-Host "Installed Hearts of Iron IV observer bridge:"
Write-Host "  Source:     $source"
Write-Host "  Mod:        $target"
Write-Host "  Descriptor: $launcherDescriptor"
Write-Host "Enable 'MonAgent Hearts of Iron IV Observer Bridge' in a launcher playset."
