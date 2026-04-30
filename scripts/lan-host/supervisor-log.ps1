# supervisor-log.ps1
#
# Hawk Eye — shared log rotation helpers for in-process supervisors
# (mdns-supervisor.ps1, the upcoming api-server supervisor, …).
#
# Hawk Eye boxes are expected to run unattended for 15+ years. A
# healthy supervisor only writes ~1 line/day, but a misbehaving one
# (Bonjour broken, port collision, hostile process killing the
# child) can flap repeatedly and grow its log without bound. To
# avoid filling %PROGRAMDATA% on the host PC, every supervisor
# writes through Write-RotatingLog instead of Add-Content directly.
#
# Rotation is in-process so we do not need an external scheduled
# task or logrotate-style daemon. Defaults: roll at 1 MiB, keep 3
# rotated copies (.1 newest, .N oldest, .N+1 discarded). Tunable
# per-supervisor via params.
#
# Dot-source from a sibling supervisor script:
#   . (Join-Path $PSScriptRoot "supervisor-log.ps1")
#   Write-RotatingLog -Path $logFile -Line $line `
#       -MaxBytes 1048576 -MaxBackups 3
#
# Get-RotatedLogCount returns the number of rotated backup files
# currently on disk (0..MaxBackups). Healthchecks use it to show
# operators that rotation is doing its job; once backups saturate
# the count plateaus at MaxBackups (it is not a cumulative
# lifetime counter).

$ErrorActionPreference = "Stop"

function Invoke-SupervisorLogRotation {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [int]$MaxBackups = 3
    )

    if (-not (Test-Path $Path)) { return }

    if ($MaxBackups -lt 1) {
        # No history requested: just discard the current file.
        try { Remove-Item -Path $Path -Force -ErrorAction Stop } catch { }
        return
    }

    # Discard the oldest copy if it would fall off the end.
    $oldest = "$Path.$MaxBackups"
    if (Test-Path $oldest) {
        try { Remove-Item -Path $oldest -Force -ErrorAction Stop } catch { }
    }

    # Shift .(N-1) -> .N, ..., .1 -> .2.
    for ($i = $MaxBackups - 1; $i -ge 1; $i--) {
        $src = "$Path.$i"
        $dst = "$Path.$($i + 1)"
        if (Test-Path $src) {
            try { Move-Item -Path $src -Destination $dst -Force -ErrorAction Stop } catch { }
        }
    }

    # Move current -> .1.
    try { Move-Item -Path $Path -Destination "$Path.1" -Force -ErrorAction Stop } catch { }
}

function Write-RotatingLog {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Line,
        [int]$MaxBytes   = 1048576,
        [int]$MaxBackups = 3
    )

    # Best-effort logger: never throw out of here. A logging failure
    # must not crash the supervisor and take the broadcast down with
    # it.
    try {
        if ($MaxBytes -gt 0 -and (Test-Path $Path)) {
            try {
                $size = (Get-Item -Path $Path -Force -ErrorAction Stop).Length
            } catch {
                $size = 0
            }
            # Approximate the line's encoded size (UTF-8 + CRLF).
            # Overshooting by one line is fine; the goal is to bound
            # growth, not to enforce a hard byte ceiling.
            $lineBytes = [System.Text.Encoding]::UTF8.GetByteCount($Line) + 2
            if (($size + $lineBytes) -gt $MaxBytes) {
                Invoke-SupervisorLogRotation -Path $Path -MaxBackups $MaxBackups
            }
        }
        Add-Content -Path $Path -Value $Line -ErrorAction Stop
    } catch { }
}

function Get-RotatedLogCount {
    param(
        [Parameter(Mandatory = $true)][string]$Path
    )
    $count = 0
    $i = 1
    while (Test-Path "$Path.$i") {
        $count++
        $i++
    }
    return $count
}
