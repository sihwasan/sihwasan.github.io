@echo off
chcp 65001 > nul
title 시화산노회 보안 점검 등록
setlocal
cd /d "%~dp0"

echo.
echo   이 컴퓨터에서 매일 오전 6시 30분에 시화산노회 바깥 보안 점검을 하도록 등록합니다.
echo   (그 시각에 컴퓨터가 꺼져 있었으면 켜진 뒤 곧 점검합니다. 창은 뜨지 않습니다)
echo.

if not exist "config.json" (
  echo   config.json 이 없어 이 컴퓨터용 열쇠를 새로 만듭니다.
  node watch.js --new-key
  echo   위 한 줄을 Supabase SQL Editor 에서 실행한 뒤 아무 키나 누르세요.
  pause > nul
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$dir = '%~dp0'.TrimEnd('\');" ^
  "$node = (Get-Command node -ErrorAction SilentlyContinue).Source;" ^
  "if (-not $node) { Write-Host '  [중단] Node.js 가 없습니다. https://nodejs.org 에서 설치한 뒤 다시 실행해 주세요.'; exit 1 }" ^
  "$a = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('\"' + $dir + '\run-hidden.vbs\" \"' + $node + '\"') -WorkingDirectory $dir;" ^
  "$t = New-ScheduledTaskTrigger -Daily -At '06:30';" ^
  "$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10);" ^
  "Register-ScheduledTask -TaskName 'Sihwasan Security Watch' -Description 'Sihwasan presbytery outside security check (tools/security-watch)' -Action $a -Trigger $t -Settings $s -Force | Out-Null;" ^
  "Write-Host '  [완료] 매일 오전 6시 30분 점검을 등록했습니다.'"

echo.
echo   지금 한 번 점검해 보려면 아무 키나 누르세요. (그만두려면 이 창을 닫으세요)
pause > nul
node watch.js
echo.
type last-run.log
echo.
pause
