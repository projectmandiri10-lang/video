@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"
set "NEED_REPAIR=0"

if not exist "node_modules" (
  echo [INFO] Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    exit /b 1
  )
)

if not exist "node_modules\@google\genai\dist\node\index.mjs" (
  set "NEED_REPAIR=1"
)
if not exist "node_modules\@babel\core\lib\index.js" (
  set "NEED_REPAIR=1"
)

if "%NEED_REPAIR%"=="1" (
  echo [WARN] Detected incomplete dependencies. Running repair install...
  call npm install --force
  if errorlevel 1 (
    echo [ERROR] Dependency repair failed.
    exit /b 1
  )
)

echo [INFO] Starting backend server (dev mode)...
call :FreePort 8787 backend
call npm run dev -w apps/server
exit /b %errorlevel%

:FreePort
set "PORT=%~1"
set "LABEL=%~2"
set "FOUND=0"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  set "FOUND=1"
  echo [WARN] Port %PORT% - !LABEL! sedang dipakai PID %%P. Menutup proses...
  taskkill /PID %%P /F >nul 2>&1
)
if "!FOUND!"=="1" (
  timeout /t 1 /nobreak >nul
)
exit /b 0
