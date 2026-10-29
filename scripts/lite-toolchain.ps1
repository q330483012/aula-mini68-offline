# Keep Cargo/Rustup from the caller's environment. Put Rust and MinGW-w64 on PATH.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if (!$env:CARGO_TARGET_DIR) {
    # An ASCII output path also supports source checkouts in non-ASCII directories.
    $env:CARGO_TARGET_DIR = Join-Path $env:LOCALAPPDATA 'mini68-build\target'
}
$env:CARGO_TARGET_DIR = [System.IO.Path]::GetFullPath($env:CARGO_TARGET_DIR)
foreach ($command in @('cargo', 'rustc', 'gcc', 'ar', 'windres', 'python')) {
    if (!(Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Missing $command on PATH. See README.md for build prerequisites."
    }
}
