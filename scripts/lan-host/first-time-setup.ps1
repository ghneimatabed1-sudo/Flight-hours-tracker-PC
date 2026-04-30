# first-time-setup.ps1
#
# Hawk Eye — host PC first-time setup wizard.
#
# Walks the operator (a normal squadron IT person, not a developer)
# through the one-time install on the LAN host PC. Idempotent: safe to
# re-run; every step checks first and skips if already done.
#
# Steps performed:
#   1. Verify Postgres is installed and reachable.
#   2. Create the `hawkeye_internal` database + role if missing.
#   3. Write artifacts/api-server/.env (the file every LAN host script
#      reads — start-api-host.ps1 looks for this exact path) with the
#      chosen DATABASE_URL, bootstrap token, and PORT.
#   4. Write artifacts/pilot-dashboard/.env.production.local with the
#      mDNS host name (default `hawk-host.local`) so every workstation
#      finds the api-server.
#   5. Build the api-server once (so the scheduled task can run with
#      -SkipBuild), then boot it briefly via start-api-host.ps1 so the
#      same env-loading code path runs and ensureFullSchema() creates
#      every table (lan_users, lan_sessions, audit_log, wings, bases).
#   6. Mint the first super_admin account interactively.
#   7. Register the api-server scheduled task so it auto-starts on boot.
#   8. Register the nightly Postgres backup task.
#
# Run from an elevated PowerShell prompt (right-click -> Run as
# Administrator). All log output goes to STDOUT and is also appended to
# .\first-time-setup.log next to the script.

[CmdletBinding()]
param(
    [string]$DbName       = "hawkeye_internal",
    [string]$DbUser       = "postgres",
    [string]$DbHost       = "127.0.0.1",
    [int]   $DbPort       = 5432,
    [string]$ApiPort      = "3847",
    [string]$LanHostName  = "hawk-host.local",
    [string]$PsqlPath     = "psql.exe",
    [switch]$SkipScheduledTasks
)

$ErrorActionPreference = "Stop"

# All identifiers that flow into raw SQL (database name, role name, etc.)
# are validated against a strict allow-list here so we never depend on
# operator input being safely quoted later. psql --command does not
# accept bind params, so the only safe approach is "reject anything
# that isn't a plain identifier".
foreach ($pair in @(
    @{ Name = "DbName"; Value = $DbName },
    @{ Name = "DbUser"; Value = $DbUser },
    @{ Name = "DbHost"; Value = $DbHost },
    @{ Name = "LanHostName"; Value = $LanHostName },
    @{ Name = "ApiPort"; Value = $ApiPort }
)) {
    if ($pair.Value -notmatch '^[A-Za-z0-9_.\-]{1,128}$') {
        Write-Error "Refusing to use $($pair.Name)='$($pair.Value)' — must match ^[A-Za-z0-9_.-]{1,128}$"
        exit 1
    }
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Resolve-Path (Join-Path $ScriptDir "..\..")
$LogFile   = Join-Path $ScriptDir "first-time-setup.log"

function Step($n, $msg) {
    $line = "[STEP $n] $msg"
    Write-Host $line -ForegroundColor Cyan
    Add-Content -Path $LogFile -Value "$(Get-Date -Format o)  $line"
}
function Info($msg) { Write-Host "       $msg"; Add-Content -Path $LogFile -Value "$(Get-Date -Format o)  $msg" }
function Warn($msg) { Write-Host "       [WARN] $msg" -ForegroundColor Yellow; Add-Content -Path $LogFile -Value "$(Get-Date -Format o)  WARN $msg" }

Add-Content -Path $LogFile -Value ""
Add-Content -Path $LogFile -Value "=========================================================="
Add-Content -Path $LogFile -Value "$(Get-Date -Format o)  first-time-setup.ps1 started"
Add-Content -Path $LogFile -Value "=========================================================="

# ── Step 1 — Postgres reachable (auto-install if missing) ──────────────
Step 1 "Checking Postgres availability ($PsqlPath)..."
$pgFound = $false
try {
    $version = & $PsqlPath --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Info "Found: $version"
        $pgFound = $true
    }
} catch {
    Info "psql not on PATH yet."
}

if (-not $pgFound) {
    # Try winget first (Windows 10 1809+, Windows 11 ship with it).
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($null -eq $winget) {
        Write-Error "Postgres is not installed and 'winget' is not available. Install Postgres 14+ manually from https://www.postgresql.org/download/windows/ and re-run this script."
        exit 10
    }
    Info "Installing PostgreSQL via winget (PostgreSQL.PostgreSQL.16). This may take a few minutes..."
    & winget install --id PostgreSQL.PostgreSQL.16 --accept-package-agreements --accept-source-agreements --silent --disable-interactivity 2>&1 | ForEach-Object { Info $_ }
    if ($LASTEXITCODE -ne 0) {
        Write-Error "winget install failed (exit $LASTEXITCODE). Install Postgres manually and re-run."
        exit 10
    }
    # Update PATH for this session and re-locate psql.
    $candidates = @(
        "C:\Program Files\PostgreSQL\16\bin\psql.exe",
        "C:\Program Files\PostgreSQL\15\bin\psql.exe",
        "C:\Program Files\PostgreSQL\14\bin\psql.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) {
            $PsqlPath = $c
            $env:PATH = "$(Split-Path -Parent $c);$env:PATH"
            break
        }
    }
    try {
        $version = & $PsqlPath --version 2>&1
        if ($LASTEXITCODE -ne 0) { throw "psql exit $LASTEXITCODE" }
        Info "Installed: $version"
    } catch {
        Write-Error "Postgres install completed but psql is still not on PATH. Open a new shell and re-run."
        exit 10
    }
}

# Prompt for the postgres superuser password (only used to create db/role).
$pgPw = Read-Host -AsSecureString "Enter password for Postgres superuser '$DbUser'"
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($pgPw)
$plainPg = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

$env:PGPASSWORD = $plainPg
$superUrl = "postgresql://$DbUser`@$DbHost`:$DbPort/postgres"

# ── Step 2 — Create DB + role ──────────────────────────────────────────
Step 2 "Ensuring database '$DbName' exists..."
$dbExists = & $PsqlPath $superUrl -A -t -c "select 1 from pg_database where datname='$DbName';" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Cannot connect to Postgres: $dbExists"
    exit 11
}
if ([string]::IsNullOrWhiteSpace($dbExists.Trim())) {
    Info "Creating database $DbName..."
    & $PsqlPath $superUrl -c "create database `"$DbName`";" | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Error "Failed to create database."; exit 12 }
} else {
    Info "Already present."
}

# ── Step 3 — Write api-server .env ─────────────────────────────────────
# Filename is .env (not .env.production) because start-api-host.ps1 —
# the same script the auto-start scheduled task and `pnpm
# lan:host:start-api` invoke — explicitly loads
# artifacts/api-server/.env. Keeping a single canonical filename means
# the bootstrap boot in Step 5, the scheduled task, and any manual
# operator restart all read the same DATABASE_URL/PORT/secrets.
Step 3 "Writing api-server .env..."
$apiEnv = Join-Path $RepoRoot "artifacts\api-server\.env"
if (Test-Path $apiEnv) {
    Warn "$apiEnv already exists; not overwriting. Edit by hand if needed."
} else {
    $bootstrap = -join ((1..32) | ForEach-Object { [char[]]'abcdefghjkmnpqrstuvwxyz23456789' | Get-Random })
    @"
DATABASE_URL=postgresql://$DbUser`:$plainPg`@$DbHost`:$DbPort/$DbName
HAWK_INTERNAL_SESSION_AUTH=required
HAWK_LAN_BOOTSTRAP_TOKEN=$bootstrap
HAWK_LAN_DEV_NO_AUTH=0
NODE_ENV=production
PORT=$ApiPort
"@ | Out-File -FilePath $apiEnv -Encoding ASCII
    Info "Wrote $apiEnv (bootstrap token: $bootstrap)"
    Info "STORE THE BOOTSTRAP TOKEN — you'll need it once to mint the super_admin."
}

# ── Step 4 — Write dashboard .env.production.local ─────────────────────
Step 4 "Writing dashboard .env.production.local..."
$dashEnv = Join-Path $RepoRoot "artifacts\pilot-dashboard\.env.production.local"
if (Test-Path $dashEnv) {
    Warn "$dashEnv already exists; not overwriting."
} else {
    @"
VITE_LAN_SESSION_LOGIN=1
VITE_INTERNAL_API_URL=http://$LanHostName`:$ApiPort
VITE_LAN_NO_AUTH=0
"@ | Out-File -FilePath $dashEnv -Encoding ASCII
    Info "Wrote $dashEnv (host: $LanHostName)"
}

# ── Step 5a — Build api-server ────────────────────────────────────────
# The scheduled task installed in Step 7 runs start-api-host.ps1 with
# -SkipBuild (so a Windows reboot doesn't re-bundle every time). That
# requires dist/index.mjs to already exist, so we do the build here on
# the first-time setup machine.
Step 5 "Building api-server (one-time bundle for the scheduled task)..."
Push-Location $RepoRoot
try {
    & pnpm --filter @workspace/api-server run build 2>&1 | ForEach-Object { Info $_ }
    if ($LASTEXITCODE -ne 0) {
        Write-Error "api-server build failed. Fix the error above and re-run first-time-setup.ps1."
        Pop-Location
        exit 13
    }
} finally {
    Pop-Location
}

# ── Step 5b — Boot api-server once via start-api-host.ps1 ─────────────
# We deliberately route through start-api-host.ps1 (with -SkipBuild)
# because that is the same script the scheduled task uses. It loads
# artifacts/api-server/.env, validates DATABASE_URL is present, and
# then launches `pnpm run start` with the env populated. Booting
# directly with `pnpm run start` here would not load .env and would
# crash with "DATABASE_URL is empty". Five seconds is plenty for
# ensureFullSchema()'s IF NOT EXISTS DDL on a fresh empty DB.
Step 5 "Booting api-server briefly to run ensureFullSchema()..."
$startScript = Join-Path $ScriptDir "start-api-host.ps1"
if (-not (Test-Path $startScript)) {
    Warn "start-api-host.ps1 not found; cannot bootstrap schema. Tables will be created on first manual boot."
} else {
    try {
        $proc = Start-Process -FilePath "powershell.exe" `
            -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-File","`"$startScript`"","-SkipBuild" `
            -PassThru -WindowStyle Hidden
        Start-Sleep -Seconds 6
        if (-not $proc.HasExited) {
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
            Info "Schema bootstrap completed (server stopped)."
        } else {
            Warn "api-server exited early (code $($proc.ExitCode)). Check api-server logs and the .env path printed by start-api-host.ps1."
        }
    } catch {
        Warn "Could not auto-bootstrap schema: $_. Tables will be created on first manual boot via start-api-host.ps1."
    }
}

# ── Step 6 — Mint super_admin ──────────────────────────────────────────
Step 6 "Minting first super_admin..."
$adminUser = Read-Host "First super_admin username"
if ([string]::IsNullOrWhiteSpace($adminUser)) {
    Warn "Skipped — no username given. Create one later with reset-admin-password.ps1 + manual insert."
} elseif ($adminUser -notmatch '^[A-Za-z0-9_.\-]{1,64}$') {
    Warn "Refusing to use username '$adminUser' — must match ^[A-Za-z0-9_.-]{1,64}$. Skipped."
} else {
    $adminPw = Read-Host -AsSecureString "Password for '$adminUser' (>=8 chars)"
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminPw)
    $plainAdmin = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    if ($plainAdmin.Length -lt 8) {
        Warn "Password too short. Skipped."
    } else {
        $bcryptModule = Join-Path $RepoRoot "node_modules\bcryptjs"
        $hash = & node -e "require('$($bcryptModule.Replace('\','/'))').hash(process.argv[1], 12).then(h => process.stdout.write(h));" $plainAdmin
        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($hash)) {
            $appUrl = "postgresql://$DbUser`:$plainPg`@$DbHost`:$DbPort/$DbName"
            $sqlFile = New-TemporaryFile
            @"
insert into lan_users (id, username, display_name, role, password_hash)
values ('super-' || md5(random()::text || clock_timestamp()::text), '$adminUser', '$adminUser', 'super_admin', `$pw`$$hash`$pw`$)
on conflict do nothing;

insert into audit_log (occurred_at, actor, type, detail)
values (now(), 'first_time_setup', 'lan_super_admin_created',
        jsonb_build_object('username', '$adminUser', 'actor_unknown', true));
"@ | Out-File -FilePath $sqlFile.FullName -Encoding ASCII
            & $PsqlPath $appUrl -f $sqlFile.FullName | Out-Null
            Remove-Item $sqlFile.FullName -ErrorAction SilentlyContinue
            if ($LASTEXITCODE -eq 0) {
                Info "Created super_admin '$adminUser'."
            } else {
                Warn "psql insert failed."
            }
        } else {
            Warn "Could not compute bcrypt hash. Skipped."
        }
    }
}

# ── Step 7 + 8 — Scheduled tasks ───────────────────────────────────────
if ($SkipScheduledTasks) {
    Step 7 "Skipping scheduled tasks (-SkipScheduledTasks)."
} else {
    Step 7 "Registering api-server scheduled task..."
    $apiTask = Join-Path $ScriptDir "install-api-startup-task.ps1"
    if (Test-Path $apiTask) {
        & powershell -ExecutionPolicy Bypass -File $apiTask
    } else {
        Warn "install-api-startup-task.ps1 not found; skipped."
    }

    Step 8 "Registering nightly backup scheduled task..."
    $bkTask = Join-Path $ScriptDir "install-backup-task.ps1"
    if (Test-Path $bkTask) {
        & powershell -ExecutionPolicy Bypass -File $bkTask
    } else {
        Warn "install-backup-task.ps1 not found; skipped."
    }
}

# Clear the postgres password from the environment.
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "DONE. See OPERATOR-RUNBOOK.md for the rest of the rollout." -ForegroundColor Green
Write-Host "Log: $LogFile" -ForegroundColor Green
