param(
    [string]$Target = "",
    [ValidateSet("debug", "release")]
    [string]$Profile = "release",
    [string]$OutputRoot = ""
)

$ErrorActionPreference = "Stop"
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $Target) {
    $Target = (rustc -vV | Select-String '^host: ' | ForEach-Object { $_.Line.Substring(6) })
}
if (-not $Target) {
    throw "Unable to determine the Rust host target. Pass -Target explicitly."
}

$platformFolder = switch -Regex ($Target) {
    '^x86_64-pc-windows-' { 'windows-x64'; break }
    '^aarch64-pc-windows-' { 'windows-arm64'; break }
    '^x86_64-apple-darwin$' { 'macos-x64'; break }
    '^aarch64-apple-darwin$' { 'macos-arm64'; break }
    '^x86_64-unknown-linux-(gnu|musl)$' { if ($Target.EndsWith('musl')) { 'linux-x64-musl' } else { 'linux-x64' }; break }
    '^aarch64-unknown-linux-(gnu|musl)$' { if ($Target.EndsWith('musl')) { 'linux-arm64-musl' } else { 'linux-arm64' }; break }
    default { throw "Unsupported distribution target: $Target" }
}

if (-not $OutputRoot) {
    $OutputRoot = Join-Path $workspaceRoot "dist"
}
$outputDirectory = Join-Path $OutputRoot $platformFolder
$executableName = if ($Target -like '*windows*') { 'mon-agent-runtime.exe' } else { 'mon-agent-runtime' }
$cargoArguments = @('build', '--locked', '-p', 'mon-agent-runtime', '--profile', $Profile, '--target', $Target)

Push-Location $workspaceRoot
try {
    & cargo @cargoArguments
    if ($LASTEXITCODE -ne 0) { throw "cargo build failed with exit code $LASTEXITCODE" }
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
    $source = Join-Path $workspaceRoot "target\$Target\$Profile\$executableName"
    $destination = Join-Path $outputDirectory $executableName
    Copy-Item -LiteralPath $source -Destination $destination -Force
    $hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath "$destination.sha256" -Value "$hash  $executableName" -Encoding ascii
    Write-Output $destination
} finally {
    Pop-Location
}
