$ErrorActionPreference = "Stop"

$agentRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..")
$escapedRoot = $agentRoot.Path.Replace("'", "''")

$command = @"
Set-Location -LiteralPath '$escapedRoot'
npm run dev
`$exitCode = `$LASTEXITCODE
Write-Host ""
if (`$exitCode -ne 0) {
  Write-Host "npm run dev exited with code `$exitCode" -ForegroundColor Red
}
Write-Host "Press any key to close this window..."
`$null = `$Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
"@

Start-Process -FilePath "powershell.exe" -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  $command
) -WorkingDirectory $agentRoot.Path -WindowStyle Normal

