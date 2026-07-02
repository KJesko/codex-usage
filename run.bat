@echo off
REM Dev convenience launcher (runs from source without installing).
python "%~dp0src\claude_usage_dashboard\app.py" %*
if errorlevel 1 pause
