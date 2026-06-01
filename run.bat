@echo off
REM ─────────────────────────────────────────────────────────────────────────────
REM  MEGALPHA — Start everything with one command
REM  Usage:  run.bat           → starts bridge + dashboard
REM          run.bat bridge    → bridge only (port 8000)
REM          run.bat dev       → dashboard only (port 3000)
REM          run.bat train     → retrain RL agent (ETH 4h 500k steps)
REM          run.bat stop      → kill bridge + dashboard
REM ─────────────────────────────────────────────────────────────────────────────

cd /d "%~dp0"

IF "%1"=="stop" (
    echo [MEGALPHA] Stopping all processes...
    taskkill /f /im python.exe /t 2>nul
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr LISTENING') do taskkill /f /pid %%a 2>nul
    echo [MEGALPHA] Stopped.
    goto :eof
)

IF "%1"=="train" (
    echo [MEGALPHA] Starting RL training: ETH 4h 500k steps...
    echo [MEGALPHA] Make sure the bridge ran at least once to build the candle cache.
    echo [MEGALPHA] This takes 20-40 minutes. Output saved to train.log
    python server\train_rl.py > train.log 2>&1
    echo [MEGALPHA] Training complete. See train.log for results.
    echo [MEGALPHA] Restart the bridge to load the new model.
    goto :eof
)

IF "%1"=="bridge" (
    echo [MEGALPHA] Starting Python bridge on port 8000...
    python server\main.py
    goto :eof
)

IF "%1"=="dev" (
    echo [MEGALPHA] Starting Next.js dashboard on port 3000...
    npm run dev
    goto :eof
)

REM ── Default: start both ──────────────────────────────────────────────────────
echo.
echo  ███╗   ███╗███████╗ ██████╗  █████╗ ██╗     ██████╗ ██╗  ██╗ █████╗
echo  ████╗ ████║██╔════╝██╔════╝ ██╔══██╗██║     ██╔══██╗██║  ██║██╔══██╗
echo  ██╔████╔██║█████╗  ██║  ███╗███████║██║     ██████╔╝███████║███████║
echo  ██║╚██╔╝██║██╔══╝  ██║   ██║██╔══██║██║     ██╔═══╝ ██╔══██║██╔══██║
echo  ██║ ╚═╝ ██║███████╗╚██████╔╝██║  ██║███████╗██║     ██║  ██║██║  ██║
echo  ╚═╝     ╚═╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝
echo.
echo  [MEGALPHA] Starting bridge + dashboard...
echo  [MEGALPHA] Bridge  → http://localhost:8000
echo  [MEGALPHA] App     → http://localhost:3000
echo  [MEGALPHA] Press Ctrl+C to stop.
echo.

REM Start bridge in a new terminal window
start "MEGALPHA Bridge" cmd /k "cd /d %~dp0 && python server\main.py"

REM Wait a moment then start dashboard
timeout /t 3 /nobreak > nul
start "MEGALPHA Dashboard" cmd /k "cd /d %~dp0 && npm run dev"

echo [MEGALPHA] Both started in separate windows.
echo [MEGALPHA] Run 'run.bat stop' to kill everything.
