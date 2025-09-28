@echo off
chcp 65001 >nul
setlocal EnableExtensions

set "Workspace=D:\Minara\devchat"
set "WorkspaceFE=D:\project\realtime-dev-chatapp"
set "WorkspaceHostDomain=C:\Users\natte\.cloudflared"

REM === Vào thư mục backend ===
cd /d "%Workspace%"

REM === Nếu có Windows Terminal thì chạy trong WT, còn không thì fallback CMD ===
where wt >nul 2>&1
if %errorlevel%==0 (
  wt -w 0 ^
    new-tab --title "gateway"   cmd /k "cd /d %Workspace% && yarn prod:gateway" ^; ^
    new-tab --title "auth"      cmd /k "cd /d %Workspace% && yarn prod:auth" ^; ^
    new-tab --title "chat"      cmd /k "cd /d %Workspace% && yarn prod:chat" ^; ^
    new-tab --title "github"    cmd /k "cd /d %Workspace% && yarn prod:github" ^; ^
    new-tab --title "upload"    cmd /k "cd /d %Workspace% && yarn prod:upload" ^; ^
    new-tab --title "notification"    cmd /k "cd /d %Workspace% && yarn prod:notification" ^; ^
    new-tab --title "frontend"  cmd /k "cd /d %WorkspaceFE% && yarn prod"
) else (
  start "gateway"   cmd /k "cd /d %Workspace% && yarn prod:gateway || pause"
  start "auth"      cmd /k "cd /d %Workspace% && yarn prod:auth || pause"
  start "chat"      cmd /k "cd /d %Workspace% && yarn prod:chat || pause"
  start "github"    cmd /k "cd /d %Workspace% && yarn prod:github || pause"
  start "upload"    cmd /k "cd /d %Workspace% && yarn prod:upload || pause"
  start "notification"    cmd /k "cd /d %Workspace% && yarn prod:notification || pause"
  start "frontend"  cmd /k "cd /d %WorkspaceFE% && yarn dev || pause"
)

cd /d "%WorkspaceHostDomain%"
call "%~dp0run-cloudflared-minimized.bat"
endlocal
