$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$pythonExe = Join-Path $projectRoot 'backend\.venv\Scripts\python.exe'
$npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
$frontendDependencies = Join-Path $projectRoot 'frontend\node_modules'
$backendDirectory = Join-Path $projectRoot 'backend'
$frontendDirectory = Join-Path $projectRoot 'frontend'
$logDirectory = Join-Path $projectRoot '.run-logs'
$backendProcess = $null
$frontendProcess = $null
$backendAlreadyRunning = $false
$frontendAlreadyRunning = $false
$script:stopRequested = $false
$cancelHandler = [ConsoleCancelEventHandler]{
    param($sender, $eventArgs)
    $eventArgs.Cancel = $true
    $script:stopRequested = $true
}

if (-not (Test-Path -LiteralPath $pythonExe)) {
    throw "Chua co backend\.venv. Hay tao moi truong ao va cai dat backend\requirements.txt truoc."
}
if (-not (Test-Path -LiteralPath $frontendDependencies)) {
    throw "Chua co frontend\node_modules. Hay chay 'npm install' trong thu muc frontend truoc."
}
if (-not (Test-Path -LiteralPath (Join-Path $backendDirectory '.env'))) {
    Write-Warning "Chua co backend\.env. Hay sao chep backend\.env.example thanh backend\.env truoc khi chay."
}

foreach ($port in @(8000, 5173)) {
    $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
    try {
        $probe.Start()
    }
    catch {
        $url = if ($port -eq 8000) { 'http://127.0.0.1:8000/health' } else { 'http://127.0.0.1:5173/' }
        try {
            $response = Invoke-WebRequest -Uri $url -TimeoutSec 3 -UseBasicParsing
            $isExpectedService = if ($port -eq 8000) {
                $response.StatusCode -eq 200 -and $response.Content -match '"status"\s*:\s*"ok"'
            } else {
                $response.StatusCode -eq 200 -and $response.Content -match '/@vite/client'
            }
            if (-not $isExpectedService) { throw "Phan hoi khong khop voi dich vu cua du an." }
            if ($port -eq 8000) { $backendAlreadyRunning = $true } else { $frontendAlreadyRunning = $true }
        }
        catch {
            throw "Cong $port dang duoc chuong trinh khac su dung va dich vu khong khop du an. Hay dung tien trinh do roi chay lai .\run.ps1."
        }
    }
    finally {
        $probe.Stop()
    }
}

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
[Console]::add_CancelKeyPress($cancelHandler)
try {
    if (-not $backendAlreadyRunning) {
        $backendProcess = Start-Process -FilePath $pythonExe -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000', '--reload') -WorkingDirectory $backendDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDirectory 'backend.log') -RedirectStandardError (Join-Path $logDirectory 'backend-error.log')
    }
    if (-not $frontendAlreadyRunning) {
        $frontendProcess = Start-Process -FilePath $npmCommand -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1', '--strictPort') -WorkingDirectory $frontendDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDirectory 'frontend.log') -RedirectStandardError (Join-Path $logDirectory 'frontend-error.log')
    }

    $startupDeadline = [DateTime]::UtcNow.AddSeconds(30)
    $backendReady = $backendAlreadyRunning
    $frontendReady = $frontendAlreadyRunning
    while ([DateTime]::UtcNow -lt $startupDeadline -and -not ($backendReady -and $frontendReady)) {
        Start-Sleep -Seconds 1
        if ($null -ne $backendProcess) {
            $backendProcess.Refresh()
            if ($backendProcess.HasExited) { throw "Backend khong khoi dong duoc. Xem .run-logs\backend-error.log." }
            $backendOutput = (Get-Content (Join-Path $logDirectory 'backend.log'), (Join-Path $logDirectory 'backend-error.log') -Raw -ErrorAction SilentlyContinue) -join "`n"
            $backendReady = $backendOutput.Contains('Application startup complete')
        }
        if ($null -ne $frontendProcess) {
            $frontendProcess.Refresh()
            if ($frontendProcess.HasExited) { throw "Frontend khong khoi dong duoc. Xem .run-logs\frontend-error.log." }
            $frontendOutput = (Get-Content (Join-Path $logDirectory 'frontend.log'), (Join-Path $logDirectory 'frontend-error.log') -Raw -ErrorAction SilentlyContinue) -join "`n"
            $frontendReady = $frontendOutput.Contains('ready in') -or ($frontendOutput -match '127\.0\.0\.1' -and $frontendOutput -match '5173')
        }
    }
    if (-not ($backendReady -and $frontendReady)) { throw "Het thoi gian cho khoi dong. Xem nhat ky trong .run-logs." }

    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "   HE THONG DANG KIEM PHUONG TIEN XE CO GIOI (AI ASSIST)" -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "  [+] Giao dien web:  http://localhost:5173" -ForegroundColor Green
    Write-Host "  [+] Backend API:    http://localhost:8000" -ForegroundColor Green
    Write-Host "  [+] API Docs:       http://localhost:8000/docs" -ForegroundColor Green
    if ($backendAlreadyRunning) { Write-Host "  [*] Backend hien da dang chay truoc do." -ForegroundColor Yellow }
    if ($frontendAlreadyRunning) { Write-Host "  [*] Frontend hien da dang chay truoc do." -ForegroundColor Yellow }
    Write-Host "  [*] Nhat ky (logs): $logDirectory" -ForegroundColor Gray
    Write-Host "----------------------------------------------------------" -ForegroundColor Cyan
    Write-Host "  >> Nhan Ctrl+C de dung toan bo he thong. <<" -ForegroundColor Yellow
    Write-Host "==========================================================" -ForegroundColor Cyan

    while (-not $script:stopRequested) {
        Start-Sleep -Seconds 1
        if ($null -ne $backendProcess) { $backendProcess.Refresh(); if ($backendProcess.HasExited) { throw "Backend da dung (ma $($backendProcess.ExitCode)). Xem .run-logs\backend-error.log." } }
        if ($null -ne $frontendProcess) { $frontendProcess.Refresh(); if ($frontendProcess.HasExited) { throw "Frontend da dung (ma $($frontendProcess.ExitCode)). Xem .run-logs\frontend-error.log." } }
    }
}
finally {
    [Console]::remove_CancelKeyPress($cancelHandler)
    foreach ($process in @($frontendProcess, $backendProcess)) {
        if ($null -ne $process -and -not $process.HasExited) {
            & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
        }
    }
    Write-Host "Da dung toan bo cac dich vu cua he thong." -ForegroundColor Green
}
