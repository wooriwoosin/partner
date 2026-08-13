@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 협력점 동기화 도구

echo ============================================
echo   협력점 동기화 도구
echo ============================================
echo.

rem 1) Node.js 설치 확인
where node >nul 2>nul
if errorlevel 1 (
  echo [안내] 이 컴퓨터에 Node.js 가 없습니다.
  echo        설치 페이지를 엽니다. "Windows Installer" 로 설치 후,
  echo        이 파일을 다시 더블클릭해 주세요.
  echo.
  start https://nodejs.org/ko/download
  pause
  exit /b
)

rem 2) 설정 파일 없으면 템플릿 복사
if not exist config.json (
  copy /y config.example.json config.json >nul
  echo [안내] config.json 을 새로 만들었습니다.
  echo        메모장으로 열어 API_URL 을 채워야 시트에 저장됩니다.
  echo        (지금은 "미리보기"까지는 됩니다)
  echo.
)

rem 3) 최초 1회 구성요소 설치
if not exist node_modules (
  echo [최초 1회] 필요한 구성요소를 설치합니다. 3~5분 정도 걸릴 수 있어요...
  echo.
  call npm install
  echo.
)

rem 4) 서버 실행 + 브라우저 자동 열기
echo 브라우저가 곧 자동으로 열립니다.
echo 이 검은 창은 프로그램이 켜져 있는 동안 그대로 두세요. (끄면 종료됩니다)
echo 끝나면 이 창을 닫으면 됩니다.
echo.
start "" /min cmd /c "timeout /t 3 >nul & start http://localhost:4180"
node server.js

pause
