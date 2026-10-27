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
    throw 'Chưa có backend\.venv. Tạo môi trường ảo và cài backend\requirements.txt trước.'
}
if (-not (Test-Path -LiteralPath $frontendDependencies)) {
    throw 'Chưa có frontend\node_modules. Chạy npm install trong thư mục frontend trước.'
}
if (-not (Test-Path -LiteralPath (Join-Path $backendDirectory '.env'))) {
    Write-Warning 'Chưa có backend\.env. Sao chép backend\.env.example thành backend\.env và cấu hình JWT_SECRET trước khi đăng nhập.'
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
            if (-not $isExpectedService) { throw 'Phản hồi không khớp với dịch vụ của dự án.' }
            if ($port -eq 8000) { $backendAlreadyRunning = $true } else { $frontendAlreadyRunning = $true }
        }
        catch {
            throw "Cổng $port đang được chương trình khác sử dụng và dịch vụ không khớp dự án. Hãy dừng tiến trình đó rồi chạy lại .\run.ps1."
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
            if ($backendProcess.HasExited) { throw 'Backend không khởi động được. Xem .run-logs\backend-error.log.' }
            $backendOutput = (Get-Content (Join-Path $logDirectory 'backend.log'), (Join-Path $logDirectory 'backend-error.log') -Raw -ErrorAction SilentlyContinue) -join "`n"
            $backendReady = $backendOutput.Contains('Application startup complete')
        }
        if ($null -ne $frontendProcess) {
            $frontendProcess.Refresh()
            if ($frontendProcess.HasExited) { throw 'Frontend không khởi động được. Xem .run-logs\frontend-error.log.' }
            $frontendOutput = (Get-Content (Join-Path $logDirectory 'frontend.log'), (Join-Path $logDirectory 'frontend-error.log') -Raw -ErrorAction SilentlyContinue) -join "`n"
            $frontendReady = $frontendOutput.Contains('ready in') -or ($frontendOutput -match '127\.0\.0\.1' -and $frontendOutput -match '5173')
        }
    }
    if (-not ($backendReady -and $frontendReady)) { throw 'Hết thời gian chờ khởi động. Xem nhật ký trong .run-logs.' }

    Write-Host 'Đang chạy dự án:' -ForegroundColor Green
    Write-Host '  Giao diện: http://localhost:5173'
    Write-Host '  Backend:   http://localhost:8000'
    Write-Host '  API docs:  http://localhost:8000/docs'
    if ($backendAlreadyRunning) { Write-Host '  Backend hiện có đang chạy; script sẽ không dừng tiến trình đó.' }
    if ($frontendAlreadyRunning) { Write-Host '  Frontend hiện có đang chạy; script sẽ không dừng tiến trình đó.' }
    Write-Host "  Nhật ký:   $logDirectory"
    Write-Host 'Nhấn Ctrl+C để dừng các dịch vụ do lệnh này khởi chạy.'

    while (-not $script:stopRequested) {
        Start-Sleep -Seconds 1
        if ($null -ne $backendProcess) { $backendProcess.Refresh(); if ($backendProcess.HasExited) { throw "Backend đã dừng (mã $($backendProcess.ExitCode)). Xem .run-logs\backend-error.log." } }
        if ($null -ne $frontendProcess) { $frontendProcess.Refresh(); if ($frontendProcess.HasExited) { throw "Frontend đã dừng (mã $($frontendProcess.ExitCode)). Xem .run-logs\frontend-error.log." } }
    }
}
finally {
    [Console]::remove_CancelKeyPress($cancelHandler)
    foreach ($process in @($frontendProcess, $backendProcess)) {
        if ($null -ne $process -and -not $process.HasExited) {
            & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
        }
    }
    Write-Host 'Đã dừng các dịch vụ của dự án.'
}
