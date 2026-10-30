@echo off
chcp 65001 > nul
title 시화산노회 AI 검색 창구 배포
cd /d "%~dp0"

echo.
echo   AI 자료 검색 창구(sihwasan-ai)를 노회 Cloudflare 계정에 올립니다.
echo   처음이면 브라우저가 열리니 Sihwasan_presbytery@naver.com 계정으로 로그인해 주세요.
echo.

call npx --yes wrangler whoami > "%TEMP%\shs-whoami.txt" 2>&1
findstr /C:"0c1cf1f4bfdcd3e33660b6d07e66378f" "%TEMP%\shs-whoami.txt" > nul
if errorlevel 1 (
  echo   노회 계정으로 로그인되어 있지 않습니다. 로그인 창을 엽니다...
  call npx --yes wrangler logout > nul 2>&1
  call npx --yes wrangler login
)

findstr /C:"KV_ID_HERE" wrangler.toml > nul
if not errorlevel 1 (
  echo.
  echo   설정 보관함 KV 를 만듭니다...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$out = (npx --yes wrangler kv namespace create AI_KV 2>&1 | Out-String);" ^
    "$m = [regex]::Match($out, 'id\s*=\s*\"([0-9a-f]{32})\"');" ^
    "if (-not $m.Success) { $m = [regex]::Match($out, '([0-9a-f]{32})') };" ^
    "if ($m.Success) { (Get-Content wrangler.toml -Raw) -replace 'KV_ID_HERE', $m.Groups[1].Value | Set-Content wrangler.toml -Encoding utf8; Write-Host ('  [완료] KV id ' + $m.Groups[1].Value) } else { Write-Host '  [실패] KV 를 만들지 못했습니다:'; Write-Host $out }"
)

echo.
echo   창구를 올립니다...
call npx --yes wrangler deploy
echo.
echo   끝났습니다. 홈페이지 「관리자 → AI 검색·API 설정」에서 열쇠를 넣고 연결 시험을 눌러 주세요.
echo.
pause
