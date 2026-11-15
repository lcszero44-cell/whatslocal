@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title WhatsLocal - Inicializador

where node >nul 2>nul
if errorlevel 1 goto missing_node

for /f "usebackq delims=" %%V in (`node -p "process.versions.node"`) do set "NODE_VERSION=%%V"
for /f "tokens=1,2 delims=." %%A in ("%NODE_VERSION%") do (
  set "NODE_MAJOR=%%A"
  set "NODE_MINOR=%%B"
)
if %NODE_MAJOR% LSS 20 goto old_node
if %NODE_MAJOR% EQU 20 if %NODE_MINOR% LSS 19 goto old_node

echo.
echo  WhatsLocal - iniciando o painel local...
echo  Node.js %NODE_VERSION%
echo.

if not exist "node_modules" (
  echo [1/3] Instalando dependencias. Isso pode levar alguns minutos na primeira vez...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto install_error
) else (
  echo [1/3] Dependencias ja instaladas.
)

if not exist "logs" mkdir "logs"
echo [2/3] Compilando o painel React...
call npm run build
if errorlevel 1 goto build_error

echo [3/3] Verificando o servidor local...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3333/health' -TimeoutSec 2; $d = $r.Content | ConvertFrom-Json; if ($r.StatusCode -eq 200 -and $d.success -eq $true -and $d.status -eq 'ok' -and $d.port -eq 3333) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 goto ready

start "WhatsLocal servidor" /min "%~dp0run-server.bat"
set "READY=0"
for /L %%I in (1,1,40) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3333/health' -TimeoutSec 2; $d = $r.Content | ConvertFrom-Json; if ($r.StatusCode -eq 200 -and $d.success -eq $true -and $d.status -eq 'ok' -and $d.port -eq 3333) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 (
    set "READY=1"
    goto ready
  )
  timeout /t 1 /nobreak >nul
)
if "%READY%"=="0" goto server_error

:ready
echo.
echo  Painel pronto: http://localhost:3333/dashboard
start "" "http://localhost:3333/dashboard"
echo  Os logs do servidor ficam em logs\server.log.
echo  Para encerrar, feche a janela "WhatsLocal servidor" no Gerenciador de Tarefas.
echo.
pause
exit /b 0

:missing_node
echo ERRO: Node.js nao foi encontrado.
echo Instale Node.js 22 LTS (ou 20.19 ou superior) em https://nodejs.org/ e execute start.bat novamente.
pause
exit /b 1

:old_node
echo ERRO: Node.js %NODE_VERSION% e antigo demais.
echo O projeto requer Node.js 20.19 ou superior. Recomendado: Node.js 22 LTS.
echo Baixe em https://nodejs.org/ e execute start.bat novamente.
pause
exit /b 1

:install_error
echo ERRO: npm install falhou. Confira a conexao com a internet e tente novamente.
pause
exit /b 1

:build_error
echo ERRO: O build do painel falhou. Consulte as mensagens acima.
pause
exit /b 1

:server_error
echo ERRO: O servidor nao respondeu na porta 3333.
echo Consulte logs\server.log. Se a porta estiver ocupada, feche o processo que a utiliza e tente novamente.
pause
exit /b 1
