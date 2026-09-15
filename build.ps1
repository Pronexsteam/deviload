# build.ps1 - build Deviload to .exe and portable folder
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot

Write-Host "=== Building Deviload ==="
Write-Host ""

# 1) ps2exe module check
if (-not (Get-Module -ListAvailable -Name ps2exe)) {
    Write-Host "Installing ps2exe module..."
    try { Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser | Out-Null } catch {}
    try { Set-PSRepository -Name PSGallery -InstallationPolicy Trusted } catch {}
    Install-Module -Name ps2exe -Scope CurrentUser -Force -AllowClobber
}
Import-Module ps2exe

# 2) icon
$ico = $null
foreach ($n in @('icon.ico', 'ico.ico')) {
    $p = Join-Path $dir $n
    if (Test-Path $p) { $ico = $p; break }
}

# 3) compilation
$src = Join-Path $dir 'YT-Downloader.ps1'
$exe = Join-Path $dir 'Deviload.exe'
Write-Host "Compiling Deviload.exe..."
$params = @{
    inputFile  = $src
    outputFile = $exe
    noConsole  = $true
    STA        = $true
    title      = 'Deviload'
    company    = 'Deviload'
    product    = 'Deviload'
}
if ($ico) {
    $params.iconFile = $ico
    Write-Host "Icon: $ico"
}
Invoke-ps2exe @params

if (-not (Test-Path $exe)) {
    Write-Host "ERROR: exe build failed."
    pause
    exit 1
}
Write-Host "Built exe: $exe"
Write-Host ""

# 4) portable folder — whitelist copy only: cookies*.txt, history.json, ui-settings.json and logs never get in
$port = Join-Path $dir 'Deviload-portable'
if (Test-Path $port) {
    Remove-Item $port -Recurse -Force
}
New-Item -ItemType Directory -Path $port | Out-Null

$include = @('Deviload.exe', 'yt-dlp.exe', 'ffmpeg.exe', 'ffprobe.exe', 'ffplay.exe', 'deno.exe', 'icon.ico', 'ico.ico', 'mascot.png',
    'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.Wpf.dll', 'WebView2Loader.dll',
    'setup.bat', 'setup.ps1', 'setup-webview2.bat', 'setup-webview2.ps1', 'setup-torrent.bat', 'setup-torrent.ps1')

foreach ($f in $include) {
    $p = Join-Path $dir $f
    if (Test-Path $p) {
        Copy-Item $p -Destination $port -Force
    }
}

$teSrc = Join-Path $dir 'torrent-engine'
if (Test-Path $teSrc) {
    $teDst = Join-Path $port 'torrent-engine'
    Copy-Item $teSrc -Destination $teDst -Recurse -Force
}

Write-Host "=== Deviload build complete ==="
Write-Host "Portable folder: $port"
Write-Host "Launch: double-click Deviload.exe"
