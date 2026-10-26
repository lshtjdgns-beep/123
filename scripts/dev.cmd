@echo off
rem Start the Next.js dev server for the Naver blog dashboard.
rem Kept ASCII-only on purpose: cmd.exe misparses UTF-8/LF files that contain Korean text.
rem Node must be on PATH; add the default install location in case the startup
rem environment (Task Scheduler / Startup folder) does not inherit the user PATH.
set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;%PATH%"
cd /d "%~dp0.."
call npm run dev -- -H 0.0.0.0 -p 3000
