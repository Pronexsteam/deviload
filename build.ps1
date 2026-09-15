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

# ffplay.exe is deliberately left out (not used by the app, ~200 MB)
$include = @('Deviload.exe', 'Deviload.vbs', 'yt-dlp.exe', 'ffmpeg.exe', 'ffprobe.exe', 'deno.exe', 'icon.ico', 'ico.ico', 'mascot.png',
    'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.Wpf.dll', 'WebView2Loader.dll',
    'setup.bat', 'setup.ps1', 'setup-webview2.bat', 'setup-webview2.ps1', 'setup-torrent.bat', 'setup-torrent.ps1',
    'LICENSE', 'README.md')

foreach ($f in $include) {
    $p = Join-Path $dir $f
    if (Test-Path $p) {
        Copy-Item $p -Destination $port -Force
    }
}

# torrent engine: sources only, node_modules is installed on the user's machine by setup-torrent.bat
$teSrc = Join-Path $dir 'torrent-engine'
if (Test-Path $teSrc) {
    $teDst = Join-Path $port 'torrent-engine'
    New-Item -ItemType Directory -Path $teDst | Out-Null
    Get-ChildItem $teSrc -File | Where-Object { $_.Name -ne 'package-lock.json' } | Copy-Item -Destination $teDst -Force
}

# licence texts of the bundled binaries and the illustrated guide
foreach ($d in @('LICENSES', 'docs')) {
    $src = Join-Path $dir $d
    if (Test-Path $src) { Copy-Item $src -Destination (Join-Path $port $d) -Recurse -Force }
}

# 5) zip (not committed: *.zip is gitignored)
$zip = Join-Path $dir 'Deviload-portable.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Write-Host "Zipping to $zip ..."
Compress-Archive -Path (Join-Path $port '*') -DestinationPath $zip -CompressionLevel Optimal
$zipMB = [math]::Round((Get-Item $zip).Length / 1MB, 1)

Write-Host "=== Deviload build complete ==="
Write-Host "Portable folder: $port"
Write-Host "Zip: $zip ($zipMB MB)"
Write-Host "Launch: double-click Deviload.exe"
