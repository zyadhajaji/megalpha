# ─────────────────────────────────────────────────────────────────────────────
# MEGALPHA — PowerShell launcher
# Usage:
#   .\run.ps1            → bridge + dashboard (two new windows)
#   .\run.ps1 bridge     → bridge only
#   .\run.ps1 dev        → dashboard only
#   .\run.ps1 train      → retrain RL agent (ETH 4h 500k steps)
#   .\run.ps1 stop       → kill everything
#   .\run.ps1 status     → show what's running + live prices
# ─────────────────────────────────────────────────────────────────────────────

param([string]$cmd = "start")

$Root = $PSScriptRoot

function Show-Banner {
    Write-Host ""
    Write-Host " MEGALPHA " -ForegroundColor Cyan -NoNewline
    Write-Host "Quant Trading Platform" -ForegroundColor White
    Write-Host " Bridge  → http://localhost:8000" -ForegroundColor DarkGray
    Write-Host " App     → http://localhost:3000" -ForegroundColor DarkGray
    Write-Host ""
}

switch ($cmd) {

    "stop" {
        Write-Host "[MEGALPHA] Stopping bridge + dashboard..." -ForegroundColor Yellow
        Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force
        $pid3k = (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue).OwningProcess
        if ($pid3k) { Stop-Process -Id $pid3k -Force -ErrorAction SilentlyContinue }
        Write-Host "[MEGALPHA] Stopped." -ForegroundColor Green
    }

    "status" {
        $bridgeUp = $null
        try { $r = Invoke-RestMethod "http://localhost:8000/health" -TimeoutSec 2; $bridgeUp = $r } catch {}
        $dashUp   = (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) -ne $null

        Write-Host ""
        Write-Host " Bridge (port 8000):    $(if ($bridgeUp) { 'RUNNING' } else { 'OFFLINE' })" -ForegroundColor $(if ($bridgeUp) { 'Green' } else { 'Red' })
        Write-Host " Dashboard (port 3000): $(if ($dashUp) { 'RUNNING' } else { 'OFFLINE' })" -ForegroundColor $(if ($dashUp) { 'Green' } else { 'Red' })
        if ($bridgeUp) {
            $p = $bridgeUp.prices
            Write-Host " BTC $($p.btc)  ETH $($p.eth)  SOL $($p.sol)" -ForegroundColor Cyan
            Write-Host " RL loaded: $($bridgeUp.rl_loaded)  HL configured: $($bridgeUp.hl_configured)" -ForegroundColor DarkGray
        }
        Write-Host ""
    }

    "bridge" {
        Show-Banner
        Write-Host "[MEGALPHA] Starting Python bridge..." -ForegroundColor Cyan
        Set-Location $Root
        python server\main.py
    }

    "dev" {
        Show-Banner
        Write-Host "[MEGALPHA] Starting Next.js dashboard..." -ForegroundColor Cyan
        Set-Location $Root
        npm run dev
    }

    "train" {
        Write-Host "[MEGALPHA] RL Training: ETH 4h 500k steps" -ForegroundColor Cyan
        Write-Host "[MEGALPHA] Requires candle cache (run bridge once first)" -ForegroundColor DarkGray
        Write-Host "[MEGALPHA] Takes 20-40 minutes. Log → train.log" -ForegroundColor DarkGray
        Set-Location $Root
        python server\train_rl.py 2>&1 | Tee-Object -FilePath train.log
        Write-Host "[MEGALPHA] Done. Restart bridge to load new policy." -ForegroundColor Green
    }

    default {
        Show-Banner
        Write-Host "[MEGALPHA] Starting bridge + dashboard in separate windows..." -ForegroundColor Cyan

        # Bridge window
        Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$Root'; python server\main.py" `
            -WindowStyle Normal

        Start-Sleep 3

        # Dashboard window
        Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$Root'; npm run dev" `
            -WindowStyle Normal

        Write-Host "[MEGALPHA] Both started." -ForegroundColor Green
        Write-Host "[MEGALPHA] Run '.\run.ps1 stop' to kill everything." -ForegroundColor DarkGray
        Write-Host "[MEGALPHA] Run '.\run.ps1 status' to check health." -ForegroundColor DarkGray
    }
}
