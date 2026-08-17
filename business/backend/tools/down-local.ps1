param([switch]$Volumes)

$ErrorActionPreference = 'Stop'
$compose = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\deploy\compose.local.yml'))
$args = @('-f', $compose, 'down', '--remove-orphans')
if ($Volumes) { $args += '-v' }
$previous = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try { docker compose @args } finally { $ErrorActionPreference = $previous }
if ($LASTEXITCODE -ne 0) { throw 'Failed to stop the local Gateway and Host containers.' }
Write-Output 'Gateway and Host containers stopped.'
