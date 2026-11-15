@echo off
cd /d "%~dp0"
if not exist "logs" mkdir "logs"
call npm start >> "logs\server.log" 2>&1
