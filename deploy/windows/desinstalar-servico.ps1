<#
.SYNOPSIS
Remove o serviço twCIN do Windows sem apagar seus dados (exceto com -PurgeData).
#>
param(
  [switch]$PurgeData,
  [string]$InstallDir = "$env:ProgramFiles\twCIN",
  [string]$DataDir = "$env:ProgramData\twCIN"
)

$ErrorActionPreference = "Stop"

$CurrentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$CurrentPrincipal = New-Object Security.Principal.WindowsPrincipal($CurrentIdentity)
if (-not $CurrentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Execute este script no PowerShell como Administrador."
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServiceId = "twCIN"

$Existing = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
if ($Existing) {
  if ($Existing.Status -ne "Stopped") {
    Stop-Service -Name $ServiceId -Force
    $Existing.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(20))
  }
  $WinSwLocal = Join-Path $ScriptDir "runtime\twcin-service.exe"
  $WinSwProgram = Join-Path $InstallDir "runtime\twcin-service.exe"
  if (Test-Path $WinSwProgram) {
    & $WinSwProgram uninstall | Out-Host
  } elseif (Test-Path $WinSwLocal) {
    & $WinSwLocal uninstall | Out-Host
  } else {
    & sc.exe delete $ServiceId | Out-Host
  }
  Write-Host "Serviço $ServiceId removido." -ForegroundColor Green
} else {
  Write-Host "Serviço $ServiceId não estava instalado."
}

if ((Test-Path $InstallDir) -and ($InstallDir -ne $ScriptDir)) {
  Remove-Item -Recurse -Force $InstallDir
  Write-Host "Arquivos do programa removidos de $InstallDir."
}

if ($PurgeData -and (Test-Path $DataDir)) {
  Remove-Item -Recurse -Force $DataDir
  Write-Host "Dados removidos de $DataDir." -ForegroundColor Yellow
} elseif (Test-Path $DataDir) {
  Write-Host "Dados preservados em $DataDir (use -PurgeData se desejar apagá-los)."
}
