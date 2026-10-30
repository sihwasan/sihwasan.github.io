@echo off
chcp 65001 > nul
title 시화산노회 보안 점검 (지금)
cd /d "%~dp0"

echo.
echo   바깥 보안 점검을 지금 합니다. 결과는 DB 로 넘어가 통합 보고가 되고,
echo   홈페이지 시스템 운영 → 보안 점검 탭에서 보실 수 있습니다.
echo.
node watch.js
echo.
type last-run.log
echo.
pause
