@echo off
setlocal EnableExtensions
chcp 65001 >nul
title STAR PRODUCTION server
set "PRISMA_HIDE_UPDATE_MESSAGE=1"
rem ------------------------------------------------------------------------
rem  STAR PRODUCTION - one-click start.
rem  npm can't install packages inside Google Drive, so the server code is
rem  copied to a local folder and run from there. The website files
rem  (index.html, Photos, data) and your .env are used directly from this
rem  project folder, so edits here show up after a browser refresh.
rem  The database lives in %LOCALAPPDATA%\star-production\db (kept between runs).
rem ------------------------------------------------------------------------

set "PROJECT=%~dp0"
if "%PROJECT:~-1%"=="\" set "PROJECT=%PROJECT:~0,-1%"
set "RUN=%LOCALAPPDATA%\star-production"
set "DBDIR=%RUN%\db"

where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org & pause & exit /b 1)
if not exist "%PROJECT%\.env" (echo Missing .env - copy .env.example to .env and fill it in. & pause & exit /b 1)

echo.
echo  [1/4] Copying server files to %RUN% ...
if not exist "%DBDIR%" mkdir "%DBDIR%"
robocopy "%PROJECT%\server" "%RUN%\server" /MIR /XD node_modules /XF *.db *.db-journal /NFL /NDL /NJH /NJS /NP >nul
robocopy "%PROJECT%\data" "%RUN%\data" /MIR /NFL /NDL /NJH /NJS /NP >nul
copy /Y "%PROJECT%\package.json" "%RUN%\package.json" >nul
copy /Y "%PROJECT%\package-lock.json" "%RUN%\package-lock.json" >nul

rem Settings for the server (these win over .env)
set "STAR_ENV_FILE=%PROJECT%\.env"
set "SITE_DIR=%PROJECT%"
set "DBPATH=%DBDIR:\=/%"
set "DATABASE_URL=file:%DBPATH%/star.db"

pushd "%RUN%"
fc /b "%RUN%\package-lock.json" "%RUN%\.installed-lock" >nul 2>nul
if errorlevel 1 (
  echo  [2/4] Installing packages ^(first run or updated, takes a minute^) ...
  call npm ci --no-fund --no-audit || (echo npm install failed. & popd & pause & exit /b 1)
  copy /Y "%RUN%\package-lock.json" "%RUN%\.installed-lock" >nul
) else (
  echo  [2/4] Packages already installed.
)

echo  [3/4] Preparing database ^(%DBDIR%\star.db^) ...
pushd "%RUN%\server"
call npx prisma generate >nul || (echo prisma generate failed. & popd & popd & pause & exit /b 1)
call npx prisma migrate deploy || (echo Database migration failed. & popd & popd & pause & exit /b 1)
call node prisma\seed.js || (echo Seeding failed. & popd & popd & pause & exit /b 1)

echo  [4/4] Starting server - keep this window open. Close it to stop the website.
if not defined STAR_NO_BROWSER start "" "http://localhost:4000"
node src\index.js
popd
popd
pause
