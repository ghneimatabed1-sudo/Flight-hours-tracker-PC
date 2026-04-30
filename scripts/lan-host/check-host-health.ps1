param(
  [string]$ApiBaseUrl                 = "http://127.0.0.1:3847",
  [int]$TimeoutSec                    = 5,
  [int]$StaleThresholdSec             = 90,
  [string]$HeartbeatPath              = "",
  [string]$MdnsHeartbeatPath          = "",
  [string]$DashboardHeartbeatPath     = ""
)

$ErrorActionPreference = "Stop"

function Normalize-Base {
  param([string]$Url)
  return $Url.TrimEnd("/")
}

# Shared `Show-SupervisorHeartbeat` helper used by all three supervisor
# sections below. Factored out so the formatting + best-effort fallback
# behavior can be unit-tested in isolation (see
# scripts/lan-host/tests/supervisor-health.tests.ps1).
$scriptDir = if ($PSScriptRoot -and $PSScriptRoot.Trim() -ne "") {
  $PSScriptRoot
} else {
  Split-Path -Parent $MyInvocation.MyCommand.Path
}
. (Join-Path $scriptDir "supervisor-health.ps1")

$base = Normalize-Base -Url $ApiBaseUrl
$healthUrl = "$base/api/healthz"

Write-Host "[hawk-eye] Checking API health at $healthUrl"

try {
  $response = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec $TimeoutSec
} catch {
  Write-Error "[hawk-eye] API health check failed: $($_.Exception.Message)"
  exit 1
}

if ($null -eq $response) {
  Write-Error "[hawk-eye] Empty health response."
  exit 1
}

$ok = $false
if ($response -is [hashtable] -or $response -is [pscustomobject]) {
  $ok = ($response.ok -eq $true)
}

if (-not $ok) {
  Write-Error "[hawk-eye] Health endpoint returned non-ok payload."
  $response | ConvertTo-Json -Depth 6
  exit 1
}

Write-Host "[hawk-eye] API healthy."
$response | ConvertTo-Json -Depth 6

# ── api-supervisor.ps1 heartbeat (best-effort) ────────────────────────
if ([string]::IsNullOrWhiteSpace($HeartbeatPath)) {
  $HeartbeatPath = Join-Path $env:ProgramData "HawkEye\api-supervisor.heartbeat"
}
Show-SupervisorHeartbeat `
  -Name "api-supervisor" `
  -HeartbeatPath $HeartbeatPath `
  -ReinstallHint "Re-run scripts\lan-host\install-api-startup-task.ps1 to install/refresh it." `
  -StaleThresholdSec $StaleThresholdSec

# ── mdns-supervisor.ps1 heartbeat (best-effort) ───────────────────────
# Hubs that opted into `-EnableMdns` get an mDNS broadcaster wrapped by
# mdns-supervisor.ps1. Surfacing it here lets a single command tell
# operators whether *all three* HawkEye supervisors (api, mdns,
# dashboard) are alive; previously they had to also run
# check-mdns-health.ps1. mDNS-disabled hubs simply warn and continue.
if ([string]::IsNullOrWhiteSpace($MdnsHeartbeatPath)) {
  $MdnsHeartbeatPath = Join-Path $env:ProgramData "HawkEye\mdns-supervisor.heartbeat"
}
Show-SupervisorHeartbeat `
  -Name "mdns-supervisor" `
  -HeartbeatPath $MdnsHeartbeatPath `
  -ReinstallHint "If mDNS was intentionally enabled, re-run scripts\lan-host\register-mdns.ps1; otherwise this warning is expected on hubs without -EnableMdns." `
  -StaleThresholdSec $StaleThresholdSec `
  -ExtraFields @("squadronName", "apiPort")

# ── dashboard-supervisor.ps1 heartbeat (best-effort) ──────────────────
# Wrapper around start-dashboard-host.ps1 (aggregator PCs) /
# launch-viewer.ps1 (kiosk viewers). Hub-only PCs simply warn and
# continue.
if ([string]::IsNullOrWhiteSpace($DashboardHeartbeatPath)) {
  $DashboardHeartbeatPath = Join-Path $env:ProgramData "HawkEye\dashboard-supervisor.heartbeat"
}
Show-SupervisorHeartbeat `
  -Name "dashboard-supervisor" `
  -HeartbeatPath $DashboardHeartbeatPath `
  -ReinstallHint "Re-run scripts\lan-host\install-dashboard-startup-task.ps1 to install/refresh it." `
  -StaleThresholdSec $StaleThresholdSec `
  -ExtraFields @("childScript", "dashboardPort")

exit 0
