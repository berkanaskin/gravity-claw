# Gravity Claw PC Bridge - Autonomous Setup
# Run this ONCE to register the bridge for auto-start.

$ErrorActionPreference = "Stop"
$bridgeDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

Write-Host ""
Write-Host "=== Gravity Claw PC Bridge - Autonomous Setup ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Build TypeScript
Write-Host "[1/5] Building TypeScript..." -ForegroundColor Yellow
Set-Location $bridgeDir
npx tsc
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAILED: TypeScript build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "OK: Build successful" -ForegroundColor Green

# Step 2: Copy .env
if (-not (Test-Path "$bridgeDir\.env")) {
    Copy-Item "$bridgeDir\.env.example" "$bridgeDir\.env"
    Write-Host "OK: .env created from .env.example" -ForegroundColor Green
}
else {
    Write-Host "OK: .env already exists" -ForegroundColor Green
}

# Step 3: Create Chrome CDP shortcut on Desktop
Write-Host "[3/5] Creating Chrome CDP shortcut..." -ForegroundColor Yellow
$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chromePath)) {
    $chromePath = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
}
if (Test-Path $chromePath) {
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut("$desktopPath\Chrome CDP.lnk")
    $shortcut.TargetPath = $chromePath
    $shortcut.Arguments = "--remote-debugging-port=9222"
    $shortcut.Description = "Chrome with CDP for Gravity Claw"
    $shortcut.Save()
    Write-Host "OK: Chrome CDP shortcut created on Desktop" -ForegroundColor Green
}
else {
    Write-Host "WARN: Chrome not found at standard path" -ForegroundColor Yellow
}

# Step 4: Register Task Scheduler
Write-Host "[4/5] Registering Task Scheduler auto-start..." -ForegroundColor Yellow
$taskName = "GravityClawPCBridge"
$batPath = "$bridgeDir\start-bridge.bat"

schtasks /Delete /TN $taskName /F 2>$null
schtasks /Create /TN $taskName /TR """$batPath""" /SC ONLOGON /RL HIGHEST /F
if ($LASTEXITCODE -eq 0) {
    Write-Host "OK: Task Scheduler registered: $taskName (runs on login)" -ForegroundColor Green
}
else {
    Write-Host "WARN: Task Scheduler failed. Try running as Administrator." -ForegroundColor Yellow
}

# Step 5: Verify Cloudflared
Write-Host "[5/5] Verifying Cloudflared..." -ForegroundColor Yellow
try {
    $cfVersion = & cloudflared --version 2>&1
    Write-Host "OK: Cloudflared ready: $cfVersion" -ForegroundColor Green
}
catch {
    Write-Host "WARN: Cloudflared not found" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Green
Write-Host "Bridge auto-starts on next login." -ForegroundColor Green
Write-Host "To start now: .\start-bridge.bat" -ForegroundColor Green
Write-Host "Cloudflare tunnel (one-time): cloudflared tunnel login" -ForegroundColor Yellow
Write-Host ""
