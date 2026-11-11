<#
.SYNOPSIS
Instala ou atualiza o twCIN como Serviço nativo do Windows Server (não invasivo).

.DESCRIPTION
- Binários/programa ficam em "C:\Program Files\twCIN" (ou na pasta atual com -Portable).
- Banco SQLite (.db), chave JWT, backups automáticos e logs ficam preservados em "C:\ProgramData\twCIN" (ou ".\data" no modo portátil).
- Roda em segundo plano sob a conta restrita "NT AUTHORITY\LocalService", com reinício automático em falhas e rotação de logs via WinSW.
- Compatível com PowerShell 3.0+ (.NET 4.0+) sem gravar UTF-8 BOM nos arquivos de configuração.
#>
param(
  [switch]$Portable,
  [switch]$OpenFirewall,
  [int]$Port = 3333,
  [string]$InstallDir = "$env:ProgramFiles\twCIN",
  [string]$DataDir = "$env:ProgramData\twCIN"
)

$ErrorActionPreference = "Stop"

$CurrentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$CurrentPrincipal = New-Object Security.Principal.WindowsPrincipal($CurrentIdentity)
if (-not $CurrentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Execute este script no PowerShell como Administrador."
}

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$SourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if ($Portable) {
  $TargetDir = $SourceDir
  $TargetData = Join-Path $SourceDir "data"
} else {
  $TargetDir = $InstallDir
  $TargetData = $DataDir
}

$ServiceId = "twCIN"
$ExistingService = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
if ($ExistingService) {
  Write-Host "Serviço $ServiceId encontrado (status: $($ExistingService.Status)). Parando para atualizar..."
  if ($ExistingService.Status -ne "Stopped") {
    Stop-Service -Name $ServiceId -Force
    $ExistingService.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(20))
  }
}

$LogsDir = Join-Path $TargetData "logs"
$BackupsDir = Join-Path $TargetData "backups"
New-Item -ItemType Directory -Force -Path $TargetDir, $TargetData, $LogsDir, $BackupsDir | Out-Null

# Copia arquivos da aplicação sem sobrescrever o diretório de dados.
if (-not $Portable) {
  foreach ($sub in @("backend", "public", "runtime", "docs")) {
    $src = Join-Path $SourceDir $sub
    if (Test-Path $src) {
      $dst = Join-Path $TargetDir $sub
      if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
      Copy-Item -Recurse -Force $src $dst
    }
  }
  foreach ($file in @("config.env.example", "iniciar-twcin.bat", "instalar-servico.ps1", "desinstalar-servico.ps1", "README.md", "CHANGELOG.md", "LICENSE")) {
    $srcFile = Join-Path $SourceDir $file
    if (Test-Path $srcFile) { Copy-Item -Force $srcFile (Join-Path $TargetDir $file) }
  }
}

$EnvDest = Join-Path $TargetData "twcin.env"
if (-not (Test-Path $EnvDest)) {
  $EnvExample = Join-Path $SourceDir "config.env.example"
  if (Test-Path $EnvExample) {
    $EnvText = ([System.IO.File]::ReadAllText($EnvExample, $Utf8NoBom)) -replace "PORT=3333", "PORT=$Port"
    [System.IO.File]::WriteAllText($EnvDest, $EnvText, $Utf8NoBom)
  }
}

# Restringe permissões NTFS dos dados via SIDs universais (Administradores, SYSTEM e LOCAL SERVICE em qualquer idioma).
& icacls $TargetData /inheritance:r /grant:r "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" "*S-1-5-19:(OI)(CI)F" | Out-Null

$NodeExe = Join-Path $TargetDir "runtime\node.exe"
if (-not (Test-Path $NodeExe)) {
  $FoundNode = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $FoundNode) {
    throw "Node.js 24+ não encontrado em '$NodeExe' nem no PATH. Use o pacote completo do Release ou instale o Node.js 24 LTS."
  }
  $NodeExe = $FoundNode.Source
}

$WinSwExe = Join-Path $TargetDir "runtime\twcin-service.exe"
if (-not (Test-Path $WinSwExe)) {
  throw "Wrapper de serviço 'runtime\twcin-service.exe' não encontrado. Para uso sem serviço nativo, execute iniciar-twcin.bat ou baixe o pacote oficial do Release."
}

$ServerScript = Join-Path $TargetDir "backend\dist\server.js"
$PublicDir = Join-Path $TargetDir "public"
$XmlPath = Join-Path $TargetDir "runtime\twcin-service.xml"

function XmlEsc([string]$v) {
  return [System.Security.SecurityElement]::Escape($v)
}

$SkipPlatformEnv = ""
if ([System.Environment]::OSVersion.Version.Major -lt 10) {
  $SkipPlatformEnv = "`r`n  <env name=`"NODE_SKIP_PLATFORM_CHECK`" value=`"1`" />"
}

$XmlContent = @"
<service>
  <id>$ServiceId</id>
  <name>twCIN — Gestão Interna de TI</name>
  <description>Servidor local offline-first de inventário, empréstimos e movimentações de equipamentos de TI.</description>
  <executable>$(XmlEsc $NodeExe)</executable>
  <arguments>"$(XmlEsc $ServerScript)"</arguments>
  <workingdirectory>$(XmlEsc $TargetDir)</workingdirectory>
  <startmode>Automatic</startmode>
  <delayedAutoStart/>
  <serviceaccount>
    <username>NT AUTHORITY\LocalService</username>
    <allowservicelogon>true</allowservicelogon>
  </serviceaccount>$SkipPlatformEnv
  <env name="NODE_ENV" value="production" />
  <env name="PORT" value="$Port" />
  <env name="HOST" value="0.0.0.0" />
  <env name="ENV_FILE" value="$(XmlEsc $EnvDest)" />
  <env name="DATA_DIR" value="$(XmlEsc $TargetData)" />
  <env name="SERVE_FRONTEND" value="true" />
  <env name="FRONTEND_DIST_DIR" value="$(XmlEsc $PublicDir)" />
  <stoptimeout>12 sec</stoptimeout>
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <resetfailure>1 hour</resetfailure>
  <logpath>$(XmlEsc $LogsDir)</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
</service>
"@
[System.IO.File]::WriteAllText($XmlPath, $XmlContent, $Utf8NoBom)

if (-not $ExistingService) {
  & $WinSwExe install | Out-Host
} else {
  Write-Host "Atualizando definição do serviço existente..."
}

Start-Service -Name $ServiceId

if ($OpenFirewall) {
  $RuleName = "twCIN Servidor Web (TCP $Port)"
  if (Get-Command New-NetFirewallRule -ErrorAction SilentlyContinue) {
    $ExistingRule = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
    if (-not $ExistingRule) {
      New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private,Domain | Out-Null
      Write-Host "Regra de firewall liberada na rede Privada/Domínio para a porta TCP $Port."
    }
  } else {
    & netsh.exe advfirewall firewall delete rule name="$RuleName" 2>$null | Out-Null
    & netsh.exe advfirewall firewall add rule name="$RuleName" dir=in action=allow protocol=TCP localport=$Port profile=private,domain | Out-Null
    Write-Host "Regra de firewall liberada via netsh na rede Privada/Domínio para a porta TCP $Port."
  }
}

Write-Host ""
Write-Host "twCIN instalado e rodando como Serviço do Windows!" -ForegroundColor Green
Write-Host "  Programa : $TargetDir"
Write-Host "  Dados    : $TargetData (banco, chave JWT, backups e logs)"
Write-Host "  URL      : http://localhost:$Port"
