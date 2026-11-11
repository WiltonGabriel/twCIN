@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "SERVICE_ID=twCIN"
set "DATA_DIR=%ProgramData%\twCIN"
if exist "%~dp0data\twcin.env" if not exist "%ProgramData%\twCIN\twcin.env" set "DATA_DIR=%~dp0data"

set "PORT_NUM=3333"
if exist "%DATA_DIR%\twcin.env" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%DATA_DIR%\twcin.env") do (
    if /i "%%A"=="PORT" if not "%%B"=="" set "PORT_NUM=%%B"
  )
)

:menu
cls
echo ==================================================
echo  twCIN - Gerenciador do Serviço Windows (%SERVICE_ID%)
echo ==================================================
echo  Dados : %DATA_DIR%
echo  URL   : http://localhost:%PORT_NUM%
echo.
powershell -NoProfile -Command "$s = Get-Service -Name '%SERVICE_ID%' -ErrorAction SilentlyContinue; if (-not $s) { Write-Host '  Status: Serviço não instalado neste computador.' -ForegroundColor Yellow } elseif ($s.Status -eq 'Running') { Write-Host '  Status: Rodando (Running)' -ForegroundColor Green } else { Write-Host ('  Status: ' + $s.Status) -ForegroundColor Yellow }"
echo.
echo  [1] Parar serviço
echo  [2] Iniciar serviço
echo  [3] Reiniciar serviço
echo  [4] Abrir painel Serviços do Windows (services.msc)
echo  [5] Abrir pasta de dados e logs
echo  [6] Abrir sistema no navegador
echo  [0] Sair
echo ==================================================
set /p "OPT=Escolha uma opção: "

if "%OPT%"=="1" goto stop_svc
if "%OPT%"=="2" goto start_svc
if "%OPT%"=="3" goto restart_svc
if "%OPT%"=="4" start "" services.msc & goto menu
if "%OPT%"=="5" if exist "%DATA_DIR%" (start "" "%DATA_DIR%") else (echo Pasta de dados não encontrada. & pause) & goto menu
if "%OPT%"=="6" start "" "http://localhost:%PORT_NUM%" & goto menu
if "%OPT%"=="0" exit /b 0
goto menu

:ensure_admin
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo Esta ação requer privilégio de Administrador. Abrindo nova janela com elevação UAC...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b 1
)
exit /b 0

:stop_svc
call :ensure_admin
if errorlevel 1 exit /b 0
echo Parando serviço %SERVICE_ID%...
powershell -NoProfile -Command "Stop-Service -Name '%SERVICE_ID%' -ErrorAction Stop"
if errorlevel 1 (echo Erro ao parar o serviço. & pause) else (echo Serviço parado com sucesso. & timeout /t 2 >nul)
goto menu

:start_svc
call :ensure_admin
if errorlevel 1 exit /b 0
echo Iniciando serviço %SERVICE_ID%...
powershell -NoProfile -Command "Start-Service -Name '%SERVICE_ID%' -ErrorAction Stop"
if errorlevel 1 (echo Erro ao iniciar o serviço. Verifique os logs em %DATA_DIR%\logs. & pause) else (echo Serviço iniciado com sucesso. & timeout /t 2 >nul)
goto menu

:restart_svc
call :ensure_admin
if errorlevel 1 exit /b 0
echo Reiniciando serviço %SERVICE_ID%...
powershell -NoProfile -Command "Restart-Service -Name '%SERVICE_ID%' -ErrorAction Stop"
if errorlevel 1 (echo Erro ao reiniciar o serviço. Verifique os logs em %DATA_DIR%\logs. & pause) else (echo Serviço reiniciado com sucesso. & timeout /t 2 >nul)
goto menu
