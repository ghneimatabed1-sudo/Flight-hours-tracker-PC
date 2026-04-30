# register-mdns.ps1
#
# Hawk Eye — optional mDNS / Bonjour broadcast for a hub PC.
#
# Advertises this hub on the LAN as `_hawkeye-hub._tcp.local`. An
# aggregator install wizard (Wing Commander PC, Base Commander PC, …)
# can then auto-discover this squadron without the operator having to
# type its hostname.
#
# OFF by default. Pass `-EnableMdns` to first-time-setup.ps1, or run
# this script directly, only on sites where mDNS is allowed on the LAN
# (some MOD networks deliberately block multicast). Air-gapped sites can
# leave it off and operators can still type `<squadron>.local` by hand.
#
# Implementation: registers a SYSTEM-context scheduled task at boot
# that runs `mdns-supervisor.ps1`. The supervisor wraps the actual
# `dns-sd.exe -R "<squadron>" _hawkeye-hub._tcp local <port>` call in
# a watchdog loop so that if dns-sd.exe is killed (OOM, manual kill,
# console session close, crash) it respawns within ~5s (capped at
# 60s on repeated rapid failures). dns-sd.exe is the Bonjour service
# registrar bundled with the Apple Bonjour Print Services installer
# and with iTunes; on a stripped-down PC without either, this script
# warns and exits cleanly so the operator can install Bonjour and
# re-run.
#
# Operators can verify the broadcast is alive at any time without
# RDP'ing to the host via:
#     scripts\lan-host\check-mdns-health.ps1
# The supervisor writes a heartbeat file at
#     %PROGRAMDATA%\HawkEye\mdns-supervisor.heartbeat
# and a rolling log at
#     %PROGRAMDATA%\HawkEye\mdns-supervisor.log
#
# Usage:
#   .\register-mdns.ps1 -SquadronName "tigers-hub" -ApiPort 3847
#   .\register-mdns.ps1 -SquadronName "tigers-hub" -Unregister

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SquadronName,

    [string]$ApiPort  = "3847",
    [string]$TaskName = "HawkEye-Mdns-OnStartup",
    [string]$DnsSdPath = "",
    [switch]$Unregister
)

$ErrorActionPreference = "Stop"

if ($SquadronName -notmatch '^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$' -or
    $SquadronName.Length -gt 15 -or
    $SquadronName -match '^[0-9]+$') {
    Write-Error "Invalid -SquadronName '$SquadronName' — must be 1-15 chars [A-Za-z0-9-], no leading/trailing hyphen, not all digits."
    exit 2
}
if ($ApiPort -notmatch '^[0-9]{1,5}$') {
    Write-Error "Invalid -ApiPort '$ApiPort'."
    exit 2
}

if ($Unregister) {
    Write-Host "[hawk-eye] Stopping any running supervisor instance: $TaskName"
    schtasks /End /TN "$TaskName" 2>&1 | Out-Null
    Write-Host "[hawk-eye] Removing scheduled task: $TaskName"
    schtasks /Delete /F /TN "$TaskName" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Could not delete task (it may not exist). Exit code: $LASTEXITCODE"
        exit 0
    }
    # Best-effort: also kill the specific dns-sd.exe child that this
    # supervisor was running, so peers stop seeing this hub
    # immediately rather than at the next OS-level mDNS cache
    # expiry. We read the child PID from the heartbeat file rather
    # than killing every dns-sd.exe on the box, which would be too
    # broad on a host that also runs unrelated Bonjour registrations.
    $heartbeatFile = Join-Path $env:ProgramData "HawkEye\mdns-supervisor.heartbeat"
    if (Test-Path $heartbeatFile) {
        try {
            $hb = (Get-Content -Path $heartbeatFile -Raw -ErrorAction Stop) | ConvertFrom-Json
            if ($hb.childPid -and [int]$hb.childPid -gt 0) {
                $childPid = [int]$hb.childPid
                $proc = Get-Process -Id $childPid -ErrorAction SilentlyContinue
                if ($proc -and $proc.ProcessName -like "dns-sd*") {
                    try {
                        Stop-Process -Id $childPid -Force -ErrorAction Stop
                        Write-Host "[hawk-eye] Stopped supervised dns-sd.exe (pid=$childPid)."
                    } catch {
                        Write-Warning "Could not stop dns-sd.exe pid=$childPid : $($_.Exception.Message)"
                    }
                }
            }
        } catch {
            Write-Warning "Could not read heartbeat file to identify child dns-sd.exe: $($_.Exception.Message)"
        }
    }
    Write-Host "[hawk-eye] mDNS broadcast task removed."
    exit 0
}

# Locate dns-sd.exe.
if ([string]::IsNullOrWhiteSpace($DnsSdPath)) {
    $found = Get-Command dns-sd.exe -ErrorAction SilentlyContinue
    if ($found) {
        $DnsSdPath = $found.Source
    } else {
        $candidates = @(
            "C:\Program Files\Bonjour\dns-sd.exe",
            "C:\Program Files (x86)\Bonjour\dns-sd.exe"
        )
        foreach ($c in $candidates) {
            if (Test-Path $c) { $DnsSdPath = $c; break }
        }
    }
}
if ([string]::IsNullOrWhiteSpace($DnsSdPath) -or -not (Test-Path $DnsSdPath)) {
    Write-Warning "dns-sd.exe not found. mDNS broadcast not registered."
    Write-Warning "Install Bonjour Print Services from https://support.apple.com/kb/dl999 and re-run this script,"
    Write-Warning "or leave mDNS disabled and have operators type '$SquadronName.local' by hand."
    exit 3
}

# The supervisor wrapper holds the foreground; it spawns dns-sd.exe
# and respawns it on any exit. We point the scheduled task at the
# supervisor instead of dns-sd.exe directly so the broadcast survives
# OOM kills, manual kills, console session closes, etc. without
# operator intervention.
$scriptDir = if ($PSScriptRoot -and $PSScriptRoot.Trim() -ne "") {
    $PSScriptRoot
} else {
    Split-Path -Parent $MyInvocation.MyCommand.Path
}
$supervisorScript = Join-Path $scriptDir "mdns-supervisor.ps1"
if (-not (Test-Path $supervisorScript)) {
    Write-Error "mdns-supervisor.ps1 not found at '$supervisorScript'. Reinstall from the source tree."
    exit 5
}

$registerCmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$supervisorScript`" -SquadronName `"$SquadronName`" -ApiPort `"$ApiPort`" -DnsSdPath `"$DnsSdPath`""

Write-Host "[hawk-eye] Registering scheduled task: $TaskName"
Write-Host "[hawk-eye] Command: $registerCmd"

# Stop any prior supervisor instance so the new task definition
# (e.g. a different ApiPort) takes effect immediately.
schtasks /End /TN "$TaskName" 2>&1 | Out-Null

# Replace any prior task definition so re-runs are idempotent.
schtasks /Create /F /RU SYSTEM /SC ONSTART /TN "$TaskName" /TR $registerCmd | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to create scheduled task '$TaskName'."
    exit 4
}

# Start it now so the broadcast is live without waiting for a reboot.
schtasks /Run /TN "$TaskName" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Could not start the task immediately (exit $LASTEXITCODE). It will start on next boot."
}

Write-Host "[hawk-eye] mDNS broadcast registered (supervised — auto-restarts on dns-sd.exe death)."
Write-Host "[hawk-eye] Service: _hawkeye-hub._tcp"
Write-Host "[hawk-eye] Name:    $SquadronName"
Write-Host "[hawk-eye] Port:    $ApiPort"
Write-Host "[hawk-eye] Verify alive: scripts\lan-host\check-mdns-health.ps1"
Write-Host "[hawk-eye] Logs:    %PROGRAMDATA%\HawkEye\mdns-supervisor.log"
Write-Host "[hawk-eye] To stop broadcasting: re-run with -Unregister"
exit 0
