@echo off
chcp 65001 >nul
setlocal EnableExtensions

REM === Luôn chạy trong thư mục devchat ===
cd /d "D:\Minara\devchat"

REM === 1. Kiểm tra Docker đã chạy chưa ===
docker info >nul 2>&1
if %errorlevel% neq 0 (
  echo [INFO] Docker Desktop chua bat. Dang mo Docker Desktop...
  start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  echo [INFO] Cho Docker khoi dong... (co the mat 20~40 giay)
  :waitDocker
  timeout /t 5 >nul
  docker info >nul 2>&1
  if %errorlevel% neq 0 (
    echo [INFO] Dang cho Docker...
    goto :waitDocker
  )
)

REM === 2. Docker da chay, tien hanh docker compose ===
echo [INFO] Khoi dong cac container voi docker compose...
docker compose up -d
if %errorlevel% neq 0 (
  echo [ERROR] Loi khi khoi dong docker compose. Dung chuong trinh.
  exit /b %errorlevel%
)

echo [SUCCESS] Docker va cac container da khoi dong thanh cong.

REM === 3. Hoi nguoi dung co muon chay devchat khong ===
choice /c 1n /n /m "Ban co muon chay devchat khong? (1 = Co, n = Khong): "
if errorlevel 2 (
  echo Khong chay devchat. Ket thuc script.
  endlocal
  exit /b 0
)
if errorlevel 1 (
  echo Dang chay devchat ...
  call "%~dp0run_app.bat"
)

endlocal
pause
