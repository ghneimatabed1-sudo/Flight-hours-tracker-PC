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
# Implementation: registers a SYSTEM-context scheduled task at boot that
# runs `dns-sd.exe -R "<squadron>" _hawkeye-hub._tcp local <port>` in
# the foreground. dns-sd.exe is the Bonjour service registrar. It is
# bundled with the Apple Bonjour Print Services installer and with
# iTunes; on a stripped-down PC without either, this script warns and
# exits cleanly so the operator can install Bonjour and re-run.
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
    Write-Host "[hawk-eye] Removing scheduled task: $TaskName"
    schtasks /Delete /F /TN "$TaskName" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Could not delete task (it may not exist). Exit code: $LASTEXITCODE"
        exit 0
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

# dns-sd.exe -R registers a service and stays in the foreground; that's
# exactly what we want under a SYSTEM scheduled task triggered at boot.
$registerCmd = "`"$DnsSdPath`" -R `"$SquadronName`" _hawkeye-hub._tcp local $ApiPort"

Write-Host "[hawk-eye] Registering scheduled task: $TaskName"
Write-Host "[hawk-eye] Command: $registerCmd"

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

Write-Host "[hawk-eye] mDNS broadcast registered."
Write-Host "[hawk-eye] Service: _hawkeye-hub._tcp"
Write-Host "[hawk-eye] Name:    $SquadronName"
Write-Host "[hawk-eye] Port:    $ApiPort"
Write-Host "[hawk-eye] To stop broadcasting: re-run with -Unregister"
exit 0
