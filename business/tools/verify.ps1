$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workspace = [IO.Path]::GetFullPath((Join-Path $root '..\..'))

& (Join-Path $workspace 'docs/tools/audit-frontend-modal-contract.ps1') -WorkspaceRoot $workspace
& (Join-Path $workspace 'docs/tools/audit-frontend-page-summary.ps1') -WorkspaceRoot $workspace

if (Test-Path -LiteralPath (Join-Path $root 'frontend')) { throw 'Legacy nested frontend directory is forbidden; use root frontend-* hosts.' }
if (Test-Path -LiteralPath (Join-Path $root 'apps/frontend')) { throw 'Legacy apps/frontend directory is forbidden; use root frontend-* hosts.' }
$requiredLayout = @(
  'backend/configs/gateway.yaml',
  'backend/internal/gateway/app',
  'backend/internal/gateway/config',
  'backend/internal/gateway/common/server',
  'backend/internal/gateway/cmd',
  'frontend-admin/package.json',
  'frontend-merch/package.json',
  'frontend-shop/package.json',
  'frontend-live/package.json'
)
# Gateway consumes wire contracts but publishes none, so it must not grow a
# protocol module of its own.
if (Test-Path -LiteralPath (Join-Path $root '../protocol')) { throw 'Gateway must not own a protocol module; it only depends on published contracts.' }
if (Test-Path -LiteralPath (Join-Path $root '../protocal')) { throw 'Gateway must not own a protocol module; it only depends on published contracts.' }
foreach ($relativePath in $requiredLayout) {
  if (-not (Test-Path -LiteralPath (Join-Path $root $relativePath))) { throw "Gateway layout is incomplete: $relativePath" }
}
$legacyReferences = rg -n 'apps/frontend/(admin|merch|shop|live)|frontend/(admin|merch|shop|live)|backend/cmd/gateway|\./cmd/gateway' $root -g '!**/tools/verify.ps1' -g '!package-lock.json' -g '!node_modules/**' -g '!dist/**' 2>$null
if ($LASTEXITCODE -eq 0 -and $legacyReferences) { throw "Legacy Gateway layout is still referenced:`n$legacyReferences" }

$frontendRoots = @(Get-ChildItem -LiteralPath $root -Directory -Filter 'frontend-*')
if ($frontendRoots.Count -ne 4) { throw "Gateway must contain exactly four root frontend-* hosts; found $($frontendRoots.Count)." }

$forbiddenState = rg -n 'REGISTRY_DATABASE_URL|IAM_DATABASE_URL|payment|inventory|order orchestration' (Join-Path $root 'backend') -g '*.go' 2>$null
if ($LASTEXITCODE -eq 0 -and $forbiddenState) {
  throw "Gateway contains platform/domain ownership indicators:`n$forbiddenState"
}

$forbiddenLegacyRuntime = rg -n 'platformBrowserRoutes|newPlatformProxy|platformProxy|module_session:|issuer:\s*liveshop-platform' `
  (Join-Path $root 'backend') -g '*.go' -g '*.yaml' -g '*.yml' 2>$null
if ($LASTEXITCODE -eq 0 -and $forbiddenLegacyRuntime) {
  throw "Legacy Platform browser runtime or signer trust is still reachable from Gateway:`n$forbiddenLegacyRuntime"
}

$forbiddenHostImports = rg -n 'modules/.*/(src|backend)|@liveshop/(catalog|order|payment|wallet|live)-' $frontendRoots.FullName 2>$null
if ($LASTEXITCODE -eq 0 -and $forbiddenHostImports) {
  throw "Host imports a business module directly:`n$forbiddenHostImports"
}

$browserSources = @($frontendRoots.FullName) + @((Join-Path $root 'packages/host-runtime'))
$directPlatformTraffic = rg -n 'VITE_REGISTRY_URL|registryBaseUrl|127\.0\.0\.1:18082' $browserSources 2>$null
if ($LASTEXITCODE -eq 0 -and $directPlatformTraffic) {
  throw "Browser Host bypasses Gateway:`n$directPlatformTraffic"
}

$editorConfig = Get-Content -Raw -LiteralPath (Join-Path $root '.editorconfig')
if ($editorConfig -notmatch '(?m)^charset\s*=\s*utf-8\s*$') { throw 'Repository .editorconfig must enforce UTF-8.' }
$frontendNginx = Get-Content -Raw -LiteralPath (Join-Path $root 'deploy/nginx.frontend.conf')
if ($frontendNginx -notmatch 'charset\s+utf-8\s*;' -or $frontendNginx -notmatch 'charset_types[^;]*text/css[^;]*application/javascript') {
  throw 'Frontend Nginx must declare UTF-8 for HTML, CSS and JavaScript.'
}

$htmlEntries = $frontendRoots | ForEach-Object {
  Get-ChildItem -LiteralPath $_.FullName -Recurse -Filter 'index.html' -File |
    Where-Object { $_.FullName -notmatch '[\/](dist|node_modules)[\/]' }
}
foreach ($entry in $htmlEntries) {
  $html = Get-Content -Raw -LiteralPath $entry.FullName
  if (-not $html.Contains('<meta charset="UTF-8" />')) { throw "HTML entry does not declare UTF-8: $($entry.FullName)" }
}

Write-Output 'go test backend'
Push-Location (Join-Path $root 'backend')
try {
  $goFiles = @(rg --files . -g '*.go')
  $unformatted = @($goFiles | ForEach-Object { gofmt -l $_ })
  if ($unformatted.Count -gt 0) { throw "Go files require gofmt:`n$($unformatted -join "`n")" }
  go vet ./...
  if ($LASTEXITCODE -ne 0) { throw 'go vet failed: backend' }
  go test ./...
  if ($LASTEXITCODE -ne 0) { throw 'go test failed: backend' }
  go run ./cmd/archcheck -root $root
  if ($LASTEXITCODE -ne 0) { throw 'architecture checks failed.' }
} finally {
  Pop-Location
}

Write-Output 'npm build gateway hosts'
Push-Location $root
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'gateway frontend build failed' }
} finally {
  Pop-Location
}

Write-Output 'All gateway checks passed.'
