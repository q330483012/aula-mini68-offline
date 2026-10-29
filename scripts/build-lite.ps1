param([switch]$SkipPrepare, [switch]$Offline)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'lite-toolchain.ps1')
$cargoOptions = @('--locked')
if ($Offline) { $cargoOptions += '--offline' }
Push-Location $root
try {
    if (!$SkipPrepare) {
        python -X utf8 scripts/prepare_web.py
        if ($LASTEXITCODE -ne 0) { throw 'Offline frontend preparation failed' }
        python -X utf8 scripts/prepare_lite.py
        if ($LASTEXITCODE -ne 0) { throw 'WebView2 frontend preparation failed' }
    }
    cargo test -p mini68-lite @cargoOptions
    if ($LASTEXITCODE -ne 0) { throw 'Native bridge tests failed' }
    cargo build -p mini68-lite --release @cargoOptions
    if ($LASTEXITCODE -ne 0) { throw 'Lightweight application build failed' }
} finally { Pop-Location }
