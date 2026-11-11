@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

if not exist "data" mkdir "data"
if not exist "data\twcin.env" copy /y "config.env.example" "data\twcin.env" >nul

ver | findstr /r "6\.[0-3]\." >nul && set "NODE_SKIP_PLATFORM_CHECK=1"
set "NODE_ENV=production"
set "ENV_FILE=%~dp0data\twcin.env"
set "DATA_DIR=%~dp0data"
set "SERVE_FRONTEND=true"
set "FRONTEND_DIST_DIR=%~dp0public"
set "PORT_AUTO_FALLBACK=true"

set "NODE_BIN=node"
if exist "%~dp0runtime\node.exe" set "NODE_BIN=%~dp0runtime\node.exe"

echo ==================================================
echo  twCIN - Servidor local (modo portátil)
echo  Se a porta configurada estiver ocupada, abre na próxima livre.
echo  Pressione Ctrl+C para encerrar com segurança.
echo ==================================================
"%NODE_BIN%" "%~dp0backend\dist\server.js"
if errorlevel 1 (
  echo.
  echo O servidor encerrou com erro. Verifique a saída acima ou confira os requisitos do sistema.
  pause
)
