@echo off
chcp 65001 >nul
setlocal EnableExtensions

set "Workspace=D:\Minara\devchat"
set "WorkspaceFE=D:\project\realtime-dev-chatapp"
set "WorkspaceHostDoamin=C:\Users\natte"

REM === Vào thư mục backend ===
cd /d "%Workspace%"

REM === Nếu có Windows Terminal thì chạy trong WT, còn không thì fallback CMD ===
where wt >nul 2>&1
if %errorlevel%==0 (
  wt -w 0 ^
    new-tab --title "gateway"   cmd /k "cd /d %Workspace% && yarn dev:gateway" ^; ^
    new-tab --title "auth"      cmd /k "cd /d %Workspace% && yarn dev:auth" ^; ^
    new-tab --title "chat"      cmd /k "cd /d %Workspace% && yarn dev:chat" ^; ^
    new-tab --title "github"    cmd /k "cd /d %Workspace% && yarn dev:github" ^; ^
    new-tab --title "upload"    cmd /k "cd /d %Workspace% && yarn dev:upload" ^; ^
    new-tab --title "frontend"  cmd /k "cd /d %WorkspaceFE% && yarn dev"^; ^
    new-tab --title "domain"  cmd /k "cd /d %WorkspaceHostDoamin% && cloudflared tunnel run my-new-tunnel"
) else (
  start "gateway"   cmd /k "cd /d %Workspace% && yarn dev:gateway || pause"
  start "auth"      cmd /k "cd /d %Workspace% && yarn dev:auth || pause"
  start "chat"      cmd /k "cd /d %Workspace% && yarn dev:chat || pause"
  start "github"    cmd /k "cd /d %Workspace% && yarn dev:github || pause"
  start "upload"    cmd /k "cd /d %Workspace% && yarn dev:upload || pause"
  start "frontend"  cmd /k "cd /d %WorkspaceFE% && yarn dev || pause"
  start "domain"    cmd /k "cd /d %WorkspaceHostDoamin% && cloudflared tunnel run my-new-tunnel || pause"
)

endlocal
