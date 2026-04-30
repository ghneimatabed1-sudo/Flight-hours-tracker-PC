param(
  [string]$ApiBaseUrl     = "http://127.0.0.1:3847",
  [int]$TimeoutSec        = 5,
  [int]$StaleThresholdSec = 90,
  [string]$HeartbeatPath  = ""
)

$ErrorActionPreference = "Stop"

function Normalize-Base {
  param([string]$Url)
  return $Url.TrimEnd("/")
}

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
# We also surface the watchdog's restart count and last exit code so
# operators can see, in one command, both that the api-server is
# answering /api/healthz right now AND whether the supervisor has had
# to respawn it recently. Mirrors check-mdns-health.ps1's heartbeat
# read. Kept best-effort: an older install without the supervisor
# (or a host where %PROGRAMDATA%\HawkEye is missing) still passes.
if ([string]::IsNullOrWhiteSpace($HeartbeatPath)) {
  $HeartbeatPath = Join-Path $env:ProgramData "HawkEye\api-supervisor.heartbeat"
}

if (-not (Test-Path $HeartbeatPath)) {
  Write-Warning "[hawk-eye] api-supervisor heartbeat not found at '$HeartbeatPath'. Either the supervisor task is not registered yet, or this host predates the supervised auto-restart wrapper. Re-run scripts\lan-host\install-api-startup-task.ps1 to install/refresh it."
  exit 0
}

try {
  $hbRaw = Get-Content -Path $HeartbeatPath -Raw -ErrorAction Stop
  $hb    = $hbRaw | ConvertFrom-Json
} catch {
  Write-Warning "[hawk-eye] Could not read api-supervisor heartbeat: $($_.Exception.Message)"
  exit 0
}

$tsRaw = $hb.timestamp
$ageSec = $null
if (-not [string]::IsNullOrWhiteSpace($tsRaw)) {
  try {
    $ts = [DateTime]::Parse(
      $tsRaw,
      [System.Globalization.CultureInfo]::InvariantCulture,
      [System.Globalization.DateTimeStyles]::RoundtripKind
    ).ToUniversalTime()
    $ageSec = [int]((Get-Date).ToUniversalTime() - $ts).TotalSeconds
  } catch {
    $ageSec = $null
  }
}

Write-Host ""
Write-Host "[hawk-eye] api-supervisor heartbeat:"
if ($null -ne $ageSec) {
  Write-Host "  timestamp     : $($hb.timestamp) (age: ${ageSec}s)"
} else {
  Write-Host "  timestamp     : $($hb.timestamp)"
}
Write-Host "  state         : $($hb.state)"
Write-Host "  childPid      : $($hb.childPid)"
Write-Host "  restartCount  : $($hb.restartCount)"
if ($null -ne $hb.lastExitCode) {
  Write-Host "  lastExitCode  : $($hb.lastExitCode)"
}
if ($null -ne $hb.lastRunSec) {
  Write-Host ("  lastRunSec    : {0:N0}" -f [double]$hb.lastRunSec)
}

if ($null -ne $ageSec -and $ageSec -gt $StaleThresholdSec) {
  Write-Warning "[hawk-eye] api-supervisor heartbeat is stale (>${StaleThresholdSec}s old). The supervisor task itself may have died — check Task Scheduler -> HawkEye-ApiServer-OnStartup, then re-run scripts\lan-host\install-api-startup-task.ps1 to reinstall it. (The api-server is still answering /api/healthz, so traffic is fine; this only means the watchdog is no longer watching.)"
}

exit 0
