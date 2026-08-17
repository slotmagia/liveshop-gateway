param([switch]$Fresh)

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) {
  throw "This deployment requires PowerShell 7. Run: pwsh -File $PSCommandPath"
}

$compose = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\deploy\compose.local.yml'))

function Invoke-Native {
  param([Parameter(Mandatory)][scriptblock]$Command, [string]$FailureMessage)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Command } finally { $ErrorActionPreference = $previous }
  if ($LASTEXITCODE -ne 0 -and $FailureMessage) { throw $FailureMessage }
}

function Ensure-LocalNetwork {
  $network = Invoke-Native { docker network ls --filter name='^liveshop-local$' --format '{{.Name}}' }
  if ($network -ne 'liveshop-local') {
    Invoke-Native { docker network create liveshop-local | Out-Null } 'Failed to create the shared Docker network liveshop-local.'
  }
}

function Wait-Http([string]$Url, [int]$TimeoutMinutes = 5) {
  $deadline = [DateTime]::UtcNow.AddMinutes($TimeoutMinutes)
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -TimeoutSec 3 -UseBasicParsing -SkipHttpErrorCheck
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  throw "Timed out waiting for $Url"
}

function Wait-Ready([string]$Url, [int]$TimeoutMinutes = 5) {
  $deadline = [DateTime]::UtcNow.AddMinutes($TimeoutMinutes)
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -TimeoutSec 3 -UseBasicParsing -SkipHttpErrorCheck
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) { return }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  throw "Timed out waiting for ready service $Url"
}

Ensure-LocalNetwork
Wait-Ready 'http://127.0.0.1:18082/readyz'
Wait-Ready 'http://127.0.0.1:18092/readyz'

if ($Fresh) {
  Invoke-Native { docker compose -f $compose down --remove-orphans } 'Failed to reset the local Gateway stack.'
}

Invoke-Native { docker compose -f $compose up -d --build } 'Local Gateway and Host deployment failed.'
foreach ($url in @(
  'http://127.0.0.1:18081/readyz',
  'http://127.0.0.1:15173',
  'http://127.0.0.1:15174',
  'http://127.0.0.1:15175',
  'http://127.0.0.1:15176'
)) {
  if ($url.EndsWith('/readyz')) { Wait-Ready $url } else { Wait-Http $url }
}

Invoke-Native { docker compose -f $compose ps }
Write-Host 'Gateway local containers are running: http://127.0.0.1:18081'
Write-Host '  Admin http://127.0.0.1:15173  Merchant http://127.0.0.1:15174  Shop http://127.0.0.1:15175  Live http://127.0.0.1:15176'
