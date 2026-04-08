param(
    [int]$PollSeconds = 20
)

$ErrorActionPreference = "Continue"

# Resolve repo root relative to this script — works regardless of username or machine
$root     = Split-Path -Parent $PSScriptRoot
$backend  = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$py       = Join-Path $backend ".venv\Scripts\python.exe"

# Find npm: prefer system install, fall back to common locations
$npm = (Get-Command npm -ErrorAction SilentlyContinue)?.Source
if (-not $npm) {
    foreach ($candidate in @(
        "C:\Program Files\nodejs\npm.cmd",
        "$env:APPDATA\npm\npm.cmd",
        "$env:ProgramFiles\nodejs\npm.cmd"
    )) {
        if (Test-Path $candidate) { $npm = $candidate; break }
    }
}
if (-not $npm) {
    Write-Error "npm not found. Install Node.js and add it to PATH."
    exit 1
}

function Start-Backend {
    $existing = Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq "python.exe" -and $_.CommandLine -like "*uvicorn convict.api.app:app*"
    }
    if ($existing) { return }

    Write-Host "$(Get-Date -f HH:mm:ss)  Starting backend…"
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-Command",
        "Set-Location '$backend'; & '$py' -m uvicorn convict.api.app:app --host 0.0.0.0 --port 8000 2>&1 | Tee-Object -FilePath '$root\backend.log' -Append"
    ) | Out-Null
}

function Start-Frontend {
    $existing = Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq "node.exe" -and $_.CommandLine -like "*next*start*"
    }
    if ($existing) { return }

    # Build if missing or stale (older than 1 hour)
    $buildId = Join-Path $frontend ".next\BUILD_ID"
    $needsBuild = -not (Test-Path $buildId) -or
                  ((Get-Date) - (Get-Item $buildId).LastWriteTime).TotalHours -gt 1

    if ($needsBuild) {
        Write-Host "$(Get-Date -f HH:mm:ss)  Building frontend…"
        Set-Location $frontend
        $env:NEXT_TELEMETRY_DISABLED = "1"
        & $npm run build
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Frontend build failed (exit $LASTEXITCODE) — skipping start"
            return
        }
    }

    Write-Host "$(Get-Date -f HH:mm:ss)  Starting frontend…"
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-Command",
        "Set-Location '$frontend'; `$env:NEXT_TELEMETRY_DISABLED='1'; & '$npm' run start -- -H 0.0.0.0 -p 3001 2>&1 | Tee-Object -FilePath '$root\frontend.log' -Append"
    ) | Out-Null
}

Write-Host "Convict 24/7 watchdog started (poll=${PollSeconds}s). Ctrl+C to stop."
Write-Host "Logs: $root\backend.log  |  $root\frontend.log"
while ($true) {
    Start-Backend
    Start-Frontend
    Start-Sleep -Seconds $PollSeconds
}
