@echo off
chcp 65001 > nul
title 시화산노회 보안 점검 해제

echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "if (Get-ScheduledTask -TaskName 'Sihwasan Security Watch' -ErrorAction SilentlyContinue) {" ^
  "  Unregister-ScheduledTask -TaskName 'Sihwasan Security Watch' -Confirm:$false; Write-Host '  매일 점검을 해제했습니다.' }" ^
  "else { Write-Host '  등록된 점검이 없습니다.' }"
echo.
echo   해제하면 바깥 점검이 오지 않으므로, 다음 날부터 보안 보고에 「바깥 점검이 오지 않았습니다」가 뜹니다.
echo.
pause
