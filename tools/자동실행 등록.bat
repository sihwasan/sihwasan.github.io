@echo off
chcp 65001 > nul
title 시화산노회 서버 자동 실행 등록
setlocal

echo.
echo   컴퓨터를 켤 때 아래 두 가지가 저절로 돌아가도록 등록합니다.
echo.
echo     1. 자료 검색 서버   (총회자료실 검색)
echo     2. 관리자 알림 봇   (텔레그램)
echo.
echo   창은 뜨지 않고 조용히 돌아갑니다.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$tools = '%~dp0'.TrimEnd('\');" ^
  "$launch = Join-Path ([Environment]::GetFolderPath('Startup')) '시화산노회 서버.vbs';" ^
  "$lines = @(" ^
  "  'Dim sh, fso'," ^
  "  'Set sh = CreateObject(\"WScript.Shell\")'," ^
  "  'Set fso = CreateObject(\"Scripting.FileSystemObject\")'," ^
  "  ('sh.CurrentDirectory = \"' + $tools + '\ai-search\"')," ^
  "  'sh.Run \"cmd /c node server.js >> server.log 2>&1\", 0, False'," ^
  "  ('If fso.FileExists(\"' + $tools + '\telegram-bot\config.json\") Then')," ^
  "  ('  sh.CurrentDirectory = \"' + $tools + '\telegram-bot\"')," ^
  "  '  sh.Run \"cmd /c node bot.js >> bot.log 2>&1\", 0, False'," ^
  "  'End If'" ^
  ");" ^
  "[System.IO.File]::WriteAllLines($launch, $lines, [System.Text.Encoding]::Unicode);" ^
  "if (Test-Path $launch) { Write-Host ('  [완료] 등록했습니다.'); Write-Host ('  위치: ' + $launch) } else { Write-Host '  [실패] 등록하지 못했습니다.' }"

echo.
echo   지금 바로 실행하려면 아무 키나 누르세요.
pause > nul

wscript "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\시화산노회 서버.vbs"

echo.
echo   실행했습니다. 잠시 뒤 홈페이지 총회자료실에서 확인해 보세요.
echo.
pause
