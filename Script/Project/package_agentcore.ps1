param([string]$Target = "")

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$arguments = @{
    Profile = "release"
    OutputRoot = (Join-Path $root "Server\bin")
}
if ($Target) {
    $arguments.Target = $Target
}
& (Join-Path $root "AgentCore\scripts\package.ps1") @arguments
