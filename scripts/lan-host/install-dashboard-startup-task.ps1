# install-dashboard-startup-task.ps1
#
# Register a Windows scheduled task that auto-starts the pilot-dashboard
# on this PC at boot. Used on aggregator (Wing / Base Commander) PCs
# where the dashboard lives next to the api-server on the same machine.
#
# Mirrors install-api-startup-task.ps1 — same schtasks pattern, same
# `-RU SYSTEM /SC ONSTART` configuration, same -SkipBuild handoff to
# the wrapper script (start-dashboard-host.ps1) so reboots don't
# re-bundle every time.

param(
  [string]$TaskName = "HawkEye-Dashboard-OnStartup",
  [string]$RepoRoot = "",
  [int]$DashboardPort = 5173
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
$startScript = Join-Path $root "scripts\lan-host\start-dashboard-host.ps1"

if (-not (Test-Path $startScript)) {
  throw "Missing script: $startScript"
}
if ($DashboardPort -lt 1 -or $DashboardPort -gt 65535) {
  throw "DashboardPort '$DashboardPort' is out of range."
}

$taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$startScript`" -SkipBuild -DashboardPort $DashboardPort"

Write-Host "[hawk-eye] Creating dashboard startup task: $TaskName (port $DashboardPort)"
schtasks /Create /F /RU SYSTEM /SC ONSTART /TN "$TaskName" /TR "$taskCommand" | Out-Null

if ($LASTEXITCODE -ne 0) {
  throw "Failed to create dashboard startup task."
}

Write-Host "[hawk-eye] Dashboard startup task installed."
Write-Host "[hawk-eye] Task name: $TaskName"
exit 0
