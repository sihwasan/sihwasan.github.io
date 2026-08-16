@echo off
chcp 65001 > nul
title 시화산노회 서버 자동 실행 해제
setlocal

set "LAUNCH=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\시화산노회 서버.vbs"

echo.
if exist "%LAUNCH%" (
  del "%LAUNCH%"
  echo   자동 실행을 해제했습니다.
  echo   다음부터는 컴퓨터를 켜도 서버가 돌아가지 않습니다.
) else (
  echo   자동 실행이 등록되어 있지 않습니다.
)

echo.
echo   지금 돌고 있는 서버도 멈추시겠습니까?
echo   멈추려면 아무 키나 누르세요. 그냥 두시려면 이 창을 닫으세요.
pause > nul

taskkill /f /im node.exe > nul 2>&1
echo   서버를 멈추었습니다.
echo.
pause
