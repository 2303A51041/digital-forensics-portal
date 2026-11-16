@echo off
setlocal
rem ==========================================================================
rem  Digital Forensics Case and Evidence Management Portal - one-click setup
rem  Student: VALLAMKONDA AKSHARA   Enrolment No.: 2303A51041
rem
rem  Double-click this file, or run "setup.bat" in a terminal in this folder.
rem  It is safe to run more than once.
rem ==========================================================================
pushd "%~dp0"

echo.
echo ==================================================================
echo   Digital Forensics Portal setup  (React + Express + MongoDB)
echo ==================================================================
echo.

rem ---------------------------------------------------------------- 1. Node.js
echo [1/6] Checking for Node.js...
where node >nul 2>nul
if errorlevel 1 goto no_node
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)"
if errorlevel 1 goto old_node
for /f "delims=" %%v in ('node -v') do echo       Found Node.js %%v
for /f "delims=" %%v in ('npm -v') do echo       Found npm %%v

rem ---------------------------------------------------------------- 2. .env
echo.
echo [2/6] Checking the settings file (.env)...
if exist ".env" (
  echo       .env already exists, leaving it unchanged.
) else if exist ".env.example" (
  copy /y ".env.example" ".env" >nul
  echo       Created .env from .env.example.
) else (
  > ".env" (
    echo PORT=5000
    echo MONGODB_URI=mongodb://localhost:27017/forensics_db
    echo JWT_SECRET=
    echo JWT_EXPIRES_IN=8h
    echo DATA_DIR=./server/data
    echo MAX_UPLOAD_MB=500
    echo CLIENT_ORIGIN=http://localhost:5173
    echo SEED_DEMO=true
  )
  echo       Created .env with default settings.
)
echo       Backend port: 5000   Database: mongodb://localhost:27017/forensics_db
echo       (Edit .env to change these, for example to use MongoDB Atlas.)

rem ---------------------------------------------------------------- 3. root packages
echo.
echo [3/6] Installing backend and root packages (npm install)...
echo       This can take a minute or two the first time.
call npm install --no-fund --no-audit
if errorlevel 1 goto npm_failed

rem ---------------------------------------------------------------- 4. client packages
echo.
echo [4/6] Installing React frontend packages (client folder)...
if exist "client\package.json" (
  pushd client
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    popd
    goto npm_failed
  )
  popd
  echo       Building the React app so "npm start" can serve it...
  call npm run build
  if errorlevel 1 goto build_failed
) else (
  echo       No client folder found, skipping.
)

rem ---------------------------------------------------------------- 5. sample data
echo.
echo [5/6] Loading sample data into MongoDB...
call npm run seed:if-empty --silent
if errorlevel 1 (
  echo.
  echo       Could not reach MongoDB, so no sample data was loaded yet.
  echo       - Local MongoDB: make sure the "MongoDB" service is running
  echo         ^(Services app, or "net start MongoDB" in an administrator terminal^).
  echo       - MongoDB Atlas: put your connection string in MONGODB_URI in .env.
  echo       The sample data is also created automatically the first time the app
  echo       starts with an empty database, so you can carry on.
)

rem ---------------------------------------------------------------- 6. done
echo.
echo [6/6] Setup complete.
echo.
echo ==================================================================
echo   HOW TO START THE APP
echo ==================================================================
echo.
echo   Development mode (recommended while working on the code):
echo       npm run dev
echo       Frontend (React):  http://localhost:5173
echo       Backend API:       http://localhost:5000/api/health
echo.
echo   Production mode (one server for everything):
echo       npm start
echo       Open:              http://localhost:5000
echo.
echo   Sign in with any demo account, password  Forensics@123
echo       admin  /  manager  /  investigator1  /  auditor
echo.
echo   Stop the app with Ctrl + C in the terminal.
echo ==================================================================
goto finish

:no_node
echo       Node.js is not installed.
where winget >nul 2>nul
if errorlevel 1 goto manual_node
echo       Trying to install Node.js LTS with winget...
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
if errorlevel 1 goto manual_node
echo.
echo       Node.js was installed. Close this window and run setup.bat again
echo       so that Windows can find the new program.
goto finish

:old_node
for /f "delims=" %%v in ('node -v') do echo       Node.js %%v is too old. Version 18 or newer is required (20 or 22 LTS recommended).
echo       Install the LTS version from https://nodejs.org and run this file again.
goto failed

:manual_node
echo       Install the LTS version from https://nodejs.org, then run this file again.
goto failed

:npm_failed
echo.
echo       Installing packages failed. Check your internet connection and try again.
goto failed

:build_failed
echo.
echo       Building the React app failed. See the messages above.
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
