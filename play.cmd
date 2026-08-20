@echo off
REM ---------------------------------------------------------------------------
REM  Hotline Strike - double-click to play.
REM
REM  Starts the vite dev server in this folder and opens the game in the default
REM  browser. Closing this window stops the server.
REM
REM  Uses the vite binary from node_modules directly rather than `npm run dev`:
REM  npm adds a second process between this window and the server, so closing
REM  the window would orphan vite and leave port 5173 held by nothing visible.
REM ---------------------------------------------------------------------------

cd /d "%~dp0"

if not exist "node_modules\vite\bin\vite.js" (
  echo.
  echo   Dependencies are not installed yet. Running npm install once...
  echo.
  call npm install || goto :failed
)

echo.
echo   Starting Hotline Strike...
echo   The browser opens by itself in a few seconds.
echo   Leave this window open while you play; close it to stop the server.
echo.

REM Give vite a moment to bind the port before the browser asks for it.
REM PowerShell rather than nested `start "" cmd /c "... & start ..."`: the cmd
REM form needs three levels of quote escaping and silently opens the wrong thing
REM when it gets them wrong. Vite itself runs in THIS window (not via `start`),
REM so Ctrl+C and closing the window both actually stop the server.
start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:5173'"

node "node_modules\vite\bin\vite.js" --port 5173 --strictPort
goto :eof

:failed
echo.
echo   npm install failed. Is Node.js installed?  https://nodejs.org
echo.
pause
