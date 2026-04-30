param(
  [string]$DatabaseUrl = "",
  [string]$BackupDir = "",
  [string]$ScratchDbName = "hawk_eye_verify_scratch"
)

# Hawk Eye — backup verification script.
#
# Runs on a quarterly cadence (registered via install-verify-backup-task.ps1).
# Picks the most-recent .dump in the backup directory, restores it into a
# scratch database, runs three sanity SELECTs, drops the scratch database,
# then writes the outcome into `system_health_marker.last_backup_verify`
# so the System Health admin page shows a fresh "Verified Xd ago" tile.
#
# A failure here means either the backups are corrupt OR the restore
# tooling is missing. Either way, the operator must act before the
# nightly task overwrites the still-good backup window.

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
  $scriptDir = if ($PSScriptRoot -and $PSScriptRoot.Trim() -ne "") {
    $PSScriptRoot
  } else {
    Split-Path -Parent $MyInvocation.MyCommand.Path
  }
  return (Resolve-Path (Join-Path $scriptDir "..\..")).Path
}

function Resolve-DatabaseUrl([string]$repoRoot, [string]$cliValue) {
  if ($cliValue -and $cliValue.Trim() -ne "") { return $cliValue }
  $env = [System.Environment]::GetEnvironmentVariable("DATABASE_URL", "Process")
  if ($env -and $env.Trim() -ne "") { return $env }
  $apiEnv = Join-Path $repoRoot "artifacts\api-server\.env"
  if (Test-Path $apiEnv) {
    Get-Content -Path $apiEnv | ForEach-Object {
      $line = $_.Trim()
      if ($line -eq "" -or $line.StartsWith("#")) { return }
      $parts = $line -split "=", 2
      if ($parts.Count -ne 2) { return }
      $k = $parts[0].Trim()
      if ($k -ne "DATABASE_URL") { return }
      $v = $parts[1].Trim()
      if ($v.StartsWith('"') -and $v.EndsWith('"')) {
        $v = $v.Substring(1, $v.Length - 2)
      }
      return $v
    } | Where-Object { $_ } | Select-Object -First 1
  }
}

function Replace-DbName([string]$url, [string]$newName) {
  # Replace the path segment after the last "/" with the scratch DB name.
  # Works for both:
  #   postgres://user:pass@host:5432/realdb
  #   postgresql://user@host/realdb?sslmode=disable
  $uri = [System.Uri]$url
  $rebuilt = "$($uri.Scheme)://$($uri.UserInfo)@$($uri.Host)"
  if ($uri.Port -gt 0 -and $uri.Port -ne 5432) {
    $rebuilt += ":$($uri.Port)"
  } elseif ($uri.Port -eq 5432) {
    $rebuilt += ":5432"
  }
  $rebuilt += "/$newName"
  if ($uri.Query) { $rebuilt += $uri.Query }
  return $rebuilt
}

function Replace-DbAdmin([string]$url) {
  return Replace-DbName -url $url -newName "postgres"
}

function Write-HealthMarker([string]$databaseUrl, [bool]$ok, [string]$message, [hashtable]$detail) {
  $detailJson = $detail | ConvertTo-Json -Compress -Depth 4
  $okLit = $(if ($ok) { "true" } else { "false" })
  $msg = $message.Replace("'", "''")
  # Use a heredoc-style multi-line query via psql -c.
  $sql = @"
insert into system_health_marker (key, ok, message, observed_at, detail)
values ('last_backup_verify', $okLit, '$msg', now(), '$detailJson'::jsonb)
on conflict (key) do update set
  ok = excluded.ok,
  message = excluded.message,
  observed_at = excluded.observed_at,
  detail = excluded.detail;
"@
  & psql --dbname $databaseUrl --set=ON_ERROR_STOP=1 --no-psqlrc -q -c $sql | Out-Null
}

# ── Main ────────────────────────────────────────────────────────────────
$root = Resolve-RepoRoot
if (-not $BackupDir -or $BackupDir.Trim() -eq "") {
  $BackupDir = Join-Path $root "artifacts\api-server\backups"
}
$DatabaseUrl = Resolve-DatabaseUrl -repoRoot $root -cliValue $DatabaseUrl
if (-not $DatabaseUrl -or $DatabaseUrl.Trim() -eq "") {
  throw "Database URL missing. Pass -DatabaseUrl, set DATABASE_URL, or fill artifacts\api-server\.env."
}

if (-not (Get-Command pg_restore -ErrorAction SilentlyContinue)) {
  throw "pg_restore is not installed or not on PATH."
}
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  throw "psql is not installed or not on PATH."
}
if (-not (Test-Path $BackupDir)) {
  throw "Backup directory not found: $BackupDir"
}

$latest = Get-ChildItem -Path $BackupDir -Filter "*.dump" -File `
  | Sort-Object LastWriteTime -Descending `
  | Select-Object -First 1
if (-not $latest) {
  $msg = "No .dump backup found in $BackupDir"
  Write-Host "[hawk-eye:verify-backup] $msg"
  Write-HealthMarker -databaseUrl $DatabaseUrl -ok $false -message $msg -detail @{ backupDir = $BackupDir }
  exit 1
}

$dumpFile = $latest.FullName
$adminUrl = Replace-DbAdmin -url $DatabaseUrl
$scratchUrl = Replace-DbName -url $DatabaseUrl -newName $ScratchDbName

Write-Host "[hawk-eye:verify-backup] Restoring $($latest.Name) into scratch DB '$ScratchDbName'…"

# Drop any leftover scratch DB from a previous failed run, then recreate it.
& psql --dbname $adminUrl --set=ON_ERROR_STOP=1 --no-psqlrc -q -c "drop database if exists ""$ScratchDbName"";" | Out-Null
if ($LASTEXITCODE -ne 0) {
  $msg = "Could not drop pre-existing scratch DB '$ScratchDbName'. Manual cleanup required."
  Write-HealthMarker -databaseUrl $DatabaseUrl -ok $false -message $msg -detail @{ backup = $dumpFile }
  throw $msg
}
& psql --dbname $adminUrl --set=ON_ERROR_STOP=1 --no-psqlrc -q -c "create database ""$ScratchDbName"";" | Out-Null
if ($LASTEXITCODE -ne 0) {
  $msg = "Could not create scratch DB '$ScratchDbName'."
  Write-HealthMarker -databaseUrl $DatabaseUrl -ok $false -message $msg -detail @{ backup = $dumpFile }
  throw $msg
}

$restoreOk = $true
$restoreError = ""
try {
  & pg_restore --dbname $scratchUrl --no-owner --no-privileges --clean --if-exists $dumpFile 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    $restoreOk = $false
    $restoreError = "pg_restore exited $LASTEXITCODE"
  }
} catch {
  $restoreOk = $false
  $restoreError = $_.Exception.Message
}

# Sanity SELECTs that should succeed on any non-corrupt Hawk Eye backup.
$sanityOk = $false
$sanityCounts = @{}
if ($restoreOk) {
  try {
    $tables = @("audit_log", "lan_users", "wings", "bases")
    foreach ($t in $tables) {
      $row = & psql --dbname $scratchUrl --set=ON_ERROR_STOP=1 --no-psqlrc -q -A -t -c "select count(*) from $t;"
      if ($LASTEXITCODE -ne 0) { throw "select count(*) from $t failed" }
      $sanityCounts[$t] = [int]$row.Trim()
    }
    $sanityOk = $true
  } catch {
    $restoreError = "sanity select failed: $($_.Exception.Message)"
  }
}

# Always drop the scratch DB.
& psql --dbname $adminUrl --set=ON_ERROR_STOP=1 --no-psqlrc -q -c "drop database if exists ""$ScratchDbName"";" | Out-Null

$detail = @{
  backup       = $dumpFile
  backupBytes  = $latest.Length
  backupMTime  = $latest.LastWriteTime.ToString("o")
  sanityCounts = $sanityCounts
}
if ($restoreOk -and $sanityOk) {
  $msg = "Verified $($latest.Name) — restored + " +
         ($sanityCounts.Keys | ForEach-Object { "$_=$($sanityCounts[$_])" }) -join " "
  Write-HealthMarker -databaseUrl $DatabaseUrl -ok $true -message $msg -detail $detail
  Write-Host "[hawk-eye:verify-backup] OK"
  exit 0
}

$msg = "Verification FAILED for $($latest.Name): $restoreError"
$detail["error"] = $restoreError
Write-HealthMarker -databaseUrl $DatabaseUrl -ok $false -message $msg -detail $detail
Write-Host "[hawk-eye:verify-backup] $msg"
exit 1
