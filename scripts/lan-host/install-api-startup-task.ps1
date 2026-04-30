param(
  [string]$TaskName = "HawkEye-ApiServer-OnStartup",
  [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
  param([string]$InputRoot)
  if ($InputRoot -and $InputRoot.Trim() -ne "") {
    return (Resolve-Path $InputRoot).Path
  }
  $scriptDir = if ($PSScriptRoot -and $PSScriptRoot.Trim() -ne "") {
    $PSScriptRoot
  } else {
    Split-Path -Parent $MyInvocation.MyCommand.Path
  }
  return (Resolve-Path (Join-Path $scriptDir "..\..")).Path
}

$root = Resolve-RepoRoot -InputRoot $RepoRoot
$supervisorScript = Join-Path $root "scripts\lan-host\api-supervisor.ps1"
$startScript      = Join-Path $root "scripts\lan-host\start-api-host.ps1"

# We point the scheduled task at api-supervisor.ps1, not start-api-host.ps1
# directly. The supervisor wraps start-api-host.ps1 (with -SkipBuild)
# in a watchdog loop so that if node crashes — OOM, unhandled
# exception, postgres glitch — it respawns within ~5s (capped at
# 60s on rapid failures) without operator intervention. Mirrors the
# mDNS supervisor pattern from register-mdns.ps1.
if (-not (Test-Path $supervisorScript)) {
  throw "Missing script: $supervisorScript"
}
if (-not (Test-Path $startScript)) {
  throw "Missing script: $startScript"
}

$taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$supervisorScript`" -RepoRoot `"$root`""

Write-Host "[hawk-eye] Creating startup task: $TaskName"
Write-Host "[hawk-eye] Command: $taskCommand"

# Stop any prior supervisor instance so a re-install picks up the
# new task definition immediately rather than at next boot.
schtasks /End /TN "$TaskName" 2>&1 | Out-Null

schtasks /Create /F /RU SYSTEM /SC ONSTART /TN "$TaskName" /TR "$taskCommand" | Out-Null

if ($LASTEXITCODE -ne 0) {
  throw "Failed to create startup task."
}

Write-Host "[hawk-eye] Startup task installed (supervised — auto-restarts on api-server death)."
Write-Host "[hawk-eye] Task name:        $TaskName"
Write-Host "[hawk-eye] Verify alive:     scripts\lan-host\check-host-health.ps1"
Write-Host "[hawk-eye] Supervisor logs:  %PROGRAMDATA%\HawkEye\api-supervisor.log"
exit 0
