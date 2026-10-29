$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'lite-toolchain.ps1')
$release = Join-Path $env:CARGO_TARGET_DIR 'x86_64-pc-windows-gnu\release'
$env:MINI68_CORE_EXE = Join-Path $release 'MINI68-Lite.exe'
$env:MINI68_WEBVIEW_LOADER = Join-Path $release 'WebView2Loader.dll'
$coreHash = (Get-FileHash -LiteralPath $env:MINI68_CORE_EXE -Algorithm SHA256).Hash.ToLowerInvariant()
$loaderHash = (Get-FileHash -LiteralPath $env:MINI68_WEBVIEW_LOADER -Algorithm SHA256).Hash.ToLowerInvariant()
$env:MINI68_PAYLOAD_ID = '0.4.3-' + $coreHash.Substring(0,16) + '-' + $loaderHash.Substring(0,8)
$stage = Join-Path $env:CARGO_TARGET_DIR 'mini68-portable'
New-Item -ItemType Directory -Force $stage,(Join-Path $root 'dist') | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'lite\icons\icon.ico') -Destination (Join-Path $stage 'icon.ico')
Set-Content -LiteralPath (Join-Path $stage 'icon.rc') -Value '1 ICON "icon.ico"' -Encoding Ascii
Push-Location $stage
try {
    windres icon.rc -O coff -o icon.o
    if ($LASTEXITCODE -ne 0) { throw 'Portable icon compilation failed' }
    rustc --edition 2021 --target x86_64-pc-windows-gnu -C opt-level=s -C strip=symbols -C panic=abort -C linker=gcc -C link-arg=icon.o (Join-Path $root 'scripts\lite-portable.rs') -o (Join-Path $root 'dist\MINI68-Lite.exe')
    if ($LASTEXITCODE -ne 0) { throw 'Portable launcher compilation failed' }
} finally {
    Pop-Location
    Remove-Item Env:\MINI68_CORE_EXE,Env:\MINI68_WEBVIEW_LOADER,Env:\MINI68_PAYLOAD_ID -ErrorAction SilentlyContinue
}
python -X utf8 (Join-Path $root 'scripts\zip_lite.py')
if ($LASTEXITCODE -ne 0) { throw 'Portable ZIP failed' }
