# setup-torrent.ps1 — installs the WebTorrent engine used for torrent playback. Requires Node.js + internet.
# Run: double-click "setup-torrent.bat".
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$te = Join-Path $dir 'torrent-engine'

Write-Host '=== Torrent engine setup (WebTorrent) ==='

# Node.js check
$nv = $null
try { $nv = (& node --version) 2>$null } catch {}
if (-not $nv) {
    Write-Host ''
    Write-Host 'ERROR: Node.js not found.'
    Write-Host 'Install Node.js (LTS) from https://nodejs.org/ , reboot and run this again.'
    Write-Host ''
    if (-not $env:CI) { pause }; exit 1
}
Write-Host "Node.js: $nv"

New-Item -ItemType Directory -Force -Path $te | Out-Null
Push-Location $te
try {
    if (-not (Test-Path (Join-Path $te 'package.json'))) {
        Write-Host 'Creating package.json...'
        & npm init -y | Out-Null
    }
    Write-Host 'Installing webtorrent (internet required, may take a minute)...'
    & npm install webtorrent@1 --no-optional --no-audit --no-fund
} finally {
    Pop-Location
}

if (Test-Path (Join-Path $te 'node_modules\webtorrent')) {
    Write-Host ''
    Write-Host 'Done! WebTorrent installed.'
    Write-Host 'Restart Deviload — the "Watch torrent" button will work.'
} else {
    Write-Host ''
    Write-Host 'ERROR: webtorrent did not install. Check your internet connection and retry.'
}
Write-Host ''
if (-not $env:CI) { pause }
