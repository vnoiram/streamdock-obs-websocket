$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

npm run package

$Manifest = Get-Content "manifest.json" -Raw | ConvertFrom-Json
$ReleaseDir = Join-Path $Root "dist/release"
New-Item -ItemType Directory -Force -Path $ReleaseDir | Out-Null
$Zip = Join-Path $ReleaseDir "streamdock-obs-websocket-$($Manifest.Version).zip"
if (Test-Path $Zip) { Remove-Item $Zip -Force }

Compress-Archive -Path @(
  "dist/stream-dock-obs-websocket.sdPlugin",
  "scripts/install-local.ps1"
) -DestinationPath $Zip
Write-Host "Wrote $Zip"
