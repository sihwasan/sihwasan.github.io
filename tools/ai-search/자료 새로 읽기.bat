@echo off
chcp 65001 > nul
title 시화산노회 자료 색인 새로 만들기
cd /d "%~dp0"

echo.
echo   총회·노회 자료를 다시 읽어 검색 색인을 새로 만듭니다.
echo.

node build-index.js

echo.
echo   끝났습니다. 검색 서버가 켜져 있다면 한 번 껐다 켜 주세요.
echo.
pause
