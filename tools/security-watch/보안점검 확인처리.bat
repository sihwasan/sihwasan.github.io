@echo off
chcp 65001 > nul
title 시화산노회 보안 점검 — 열쇠 확인 처리
cd /d "%~dp0"

echo.
echo   저장소(지난 기록 포함)에서 찾은 비밀 열쇠를 「확인 처리」합니다.
echo   그 열쇠를 이미 폐기·재발급했거나, 예시값임을 확인한 경우에만 계속하세요.
echo   확인 처리한 열쇠는 다음 점검부터 건너뜁니다. (새로 생기는 열쇠는 계속 잡습니다)
echo.
echo   계속하려면 아무 키나 누르세요. 그만두려면 이 창을 닫으세요.
pause > nul
node watch.js --ack
echo.
pause
