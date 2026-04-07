param(
    [int]$PollSeconds = 20
)

$ErrorActionPreference = "Continue"

$root = "c:\Users\sarvesh\Desktop\convict"
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$py = Join-Path $backend ".venv\Scripts\python.exe"
$npm = "C:\Program Files\nodejs\npm.cmd"

function Start-Backend {
    $existing = Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq "python.exe" -and $_.CommandLine -like "*uvicorn convict.api.app:app*"
    }
    if ($existing) { return }

    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-Command",
        "Set-Location '$backend'; & '$py' -m uvicorn convict.api.app:app --host 0.0.0.0 --port 8000"
    ) | Out-Null
}

function Start-Frontend {
    $existing = Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq "node.exe" -and $_.CommandLine -like "*next*start*3000*"
    }
    if ($existing) { return }

    # Build only if production build is missing.
    if (!(Test-Path (Join-Path $frontend ".next\BUILD_ID"))) {
        Set-Location $frontend
        & $npm run build | Out-Null
    }

    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-Command",
        "Set-Location '$frontend'; `$env:NEXT_TELEMETRY_DISABLED='1'; & '$npm' run start -- -H 0.0.0.0 -p 3000"
    ) | Out-Null
}

Write-Host "24/7 watchdog started. Press Ctrl+C to stop."
while ($true) {
    Start-Backend
    Start-Frontend
    Start-Sleep -Seconds $PollSeconds
}
