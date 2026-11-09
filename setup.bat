@echo off
setlocal
rem One-step setup for Windows. Double-click this file, or run setup.bat in a terminal.
pushd "%~dp0"

echo.
echo === Digital Forensics Portal setup ===
echo.

echo [1/3] Checking for Node.js...
where node >nul 2>nul
if errorlevel 1 goto install_node

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 goto old_node

for /f "delims=" %%v in ('node -v') do echo       Found Node.js %%v
goto dependencies

:old_node
for /f "delims=" %%v in ('node -v') do echo       Node.js %%v is too old. Version 22.13 or newer is required.
echo       Install the current LTS version from https://nodejs.org and run this file again.
goto failed

:install_node
echo       Node.js is not installed. Trying to install it with winget...
where winget >nul 2>nul
if errorlevel 1 goto manual_node
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
if errorlevel 1 goto manual_node
echo.
echo       Node.js was installed. Close this window, then run setup.bat again
echo       so that Windows can find the new program.
goto finish

:manual_node
echo       Could not install Node.js automatically.
echo       Install the LTS version from https://nodejs.org and run this file again.
goto failed

:dependencies
echo.
echo [2/3] Installing project packages. This can take a minute...
call npm install --no-fund --no-audit
if errorlevel 1 goto npm_failed

echo.
echo [3/3] Creating settings file...
if exist ".env" (
  echo       .env already exists, leaving it unchanged.
) else (
  copy /y ".env.example" ".env" >nul
  echo       Created .env with default settings.
)

echo.
echo === Setup complete ===
echo.
echo To start the portal, run:   npm start
echo Then open in your browser:  http://localhost:3000
echo Sign in as admin with password Forensics@123
goto finish

:npm_failed
echo.
echo       Installing packages failed. Check your internet connection and try again.
goto failed

:failed
echo.
echo Setup did not finish.
popd
pause
exit /b 1

:finish
echo.
popd
pause
exit /b 0
