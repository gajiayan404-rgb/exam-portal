@echo off
title CodeAura Classroom Exam Server
cd /d "%~dp0"
echo ============================================
echo   Starting CodeAura Classroom Exam Portal
echo ============================================
echo.
node server.js
if errorlevel 1 (
  echo.
  echo Failed to start server. Make sure Node.js is installed.
  pause
)
