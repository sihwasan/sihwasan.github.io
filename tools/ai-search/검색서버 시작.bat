@echo off
chcp 65001 > nul
title 시화산노회 자료 검색 서버
cd /d "%~dp0"

echo.
echo   시화산노회 자료 검색 서버를 준비합니다...
echo.

if not exist "index.json" (
  echo   처음 실행이라 자료 색인을 먼저 만듭니다. 잠시만 기다려 주세요.
  echo.
  node build-index.js
  echo.
)

node server.js

echo.
echo   서버가 멈추었습니다. 이 창은 닫으셔도 됩니다.
pause
