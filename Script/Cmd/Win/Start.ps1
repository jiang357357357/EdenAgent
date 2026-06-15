param(
  [switch]$Foreground
)

$ErrorActionPreference = "Stop"

$agentRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..")
$escapedRoot = $agentRoot.Path.Replace("'", "''")

function Get-MonConfigValue {
  param(
    [string]$Section,
    [string]$Key,
    [string]$DefaultValue
  )

  $configPath = Join-Path $agentRoot.Path ".monconfig"
  if (-not (Test-Path -LiteralPath $configPath)) {
    return $DefaultValue
  }

  $currentSection = ""
  foreach ($line in Get-Content -LiteralPath $configPath) {
    $trimmed = $line.Trim()
    if ($trimmed -eq "" -or $trimmed.StartsWith("#")) {
      continue
    }
    if ($trimmed -match '^\[(.+)\]$') {
      $currentSection = $Matches[1]
      continue
    }
    if ($currentSection -eq $Section -and $trimmed -match "^$([regex]::Escape($Key))=(.*)$") {
      return $Matches[1].Trim()
    }
  }

  return $DefaultValue
}

$serverPort = Get-MonConfigValue -Section "server" -Key "PORT" -DefaultValue "40092"
$webPort = Get-MonConfigValue -Section "server" -Key "WEB_PORT" -DefaultValue "40091"

function Test-MonAgentDevProcess {
  param(
    [int]$ProcessId
  )

  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if (-not $processInfo -or -not $processInfo.CommandLine) {
    return $false
  }

  $commandLine = $processInfo.CommandLine
  $rootPattern = [regex]::Escape($agentRoot.Path)
  return (
    $commandLine -match $rootPattern -or
    $commandLine -match 'server[\\/]src[\\/]server\.ts' -or
    $commandLine -match 'frontend[\\/]web[\\/]node_modules[\\/]vite' -or
    $commandLine -match 'npm run dev'
  )
}

function Stop-ProcessTree {
  param(
    [int]$ProcessId
  )

  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (-not $process) {
    return
  }

  Write-Host "清理旧进程：PID $ProcessId ($($process.ProcessName))" -ForegroundColor DarkYellow
  & taskkill.exe /PID $ProcessId /T /F | Out-Null
}

function Clear-MonAgentDevProcesses {
  $ports = @([int]$serverPort, [int]$webPort)
  $owners = Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique

  foreach ($owner in $owners) {
    if (-not $owner -or $owner -eq $PID) {
      continue
    }

    if (Test-MonAgentDevProcess -ProcessId $owner) {
      Stop-ProcessTree -ProcessId $owner
    } else {
      Write-Warning "端口被非 MonAgent 进程占用，未自动清理：PID $owner"
    }
  }

  $staleShells = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessId -ne $PID -and
    $_.CommandLine -and
    $_.CommandLine -match [regex]::Escape($agentRoot.Path) -and
    $_.CommandLine -match 'npm run dev'
  }

  foreach ($shell in $staleShells) {
    Stop-ProcessTree -ProcessId $shell.ProcessId
  }
}

Clear-MonAgentDevProcesses

if ($Foreground) {
  Set-Location -LiteralPath $agentRoot.Path
  Write-Host "MonAgent foreground dev starting..." -ForegroundColor Cyan
  Write-Host "Root:   $($agentRoot.Path)"
  Write-Host "Web:    http://127.0.0.1:$webPort/"
  Write-Host "Server: http://127.0.0.1:$serverPort/"
  Write-Host ""
  npm run dev
  exit $LASTEXITCODE
}

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

$process = Start-Process -FilePath "powershell.exe" -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  $command
) -WorkingDirectory $agentRoot.Path -WindowStyle Normal -PassThru

Write-Host "MonAgent dev 已在独立终端启动。" -ForegroundColor Green
Write-Host "PID:    $($process.Id)"
Write-Host "Root:   $($agentRoot.Path)"
Write-Host "Web:    http://127.0.0.1:$webPort/"
Write-Host "Server: http://127.0.0.1:$serverPort/"
Write-Host "日志在新打开的 PowerShell 窗口中；如需当前窗口显示日志："
Write-Host "  $PSCommandPath -Foreground"
