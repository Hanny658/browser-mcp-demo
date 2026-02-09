@echo off
setlocal

set ROOT=%~dp0

start "backend" cmd /k "cd /d %ROOT% && npm run dev"
start "frontend" cmd /k "cd /d %ROOT%demo_frontend && npm run dev"

timeout /t 3 >nul
sleep 2
start "" "http://localhost:5173/"

endlocal
