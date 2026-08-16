@echo off
chcp 65001 > nul
title 시화산노회 관리자 알림 봇
cd /d "%~dp0"

if not exist "config.json" (
  echo.
  echo   config.json 이 없습니다.
  echo   config.sample.json 을 config.json 으로 복사한 뒤
  echo   봇 토큰과 Supabase 키를 적어 주세요.
  echo   자세한 방법은 README.md 에 있습니다.
  echo.
  pause
  exit /b 1
)

node bot.js

echo.
echo   봇이 멈추었습니다. 이 창은 닫으셔도 됩니다.
pause
