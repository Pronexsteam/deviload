# setup.ps1 — one-shot dependency setup for a fresh machine.
# Downloads into the app folder (files that already exist are skipped):
#   yt-dlp.exe, ffmpeg.exe / ffprobe.exe / ffplay.exe (BtbN build), deno.exe,
#   then the WebView2 SDK DLLs via setup-webview2.ps1 (HD in-app playback).
# Run: double-click "setup.bat". Internet connection required.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # the Invoke-WebRequest progress bar slows large downloads down badly
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$dir = $PSScriptRoot
$tmp = Join-Path $env:TEMP 'deviload-setup'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

Write-Host '=== Deviload dependency setup ==='
Write-Host "Folder: $dir"
Write-Host ''

function Get-File($url, $dest) {
    Write-Host "  downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
}
function Copy-FromZip($zip, $pattern, $dest) {
    # extract a single file (matched by name pattern) from a zip into the app folder
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z = [System.IO.Compression.ZipFile]::OpenRead($zip)
    try {
        $entry = $z.Entries | Where-Object { $_.FullName -match $pattern } | Select-Object -First 1
        if (-not $entry) { throw "entry '$pattern' not found in $zip" }
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest, $true)
    } finally { $z.Dispose() }
}

# 1) yt-dlp
$ytdlp = Join-Path $dir 'yt-dlp.exe'
if (Test-Path $ytdlp) { Write-Host 'yt-dlp.exe: present, skipped' }
else {
    Write-Host 'yt-dlp.exe:'
    Get-File 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' $ytdlp
}

# 2) ffmpeg / ffprobe / ffplay (BtbN win64 GPL build, three exes in bin/)
$ffNeeded = @('ffmpeg.exe', 'ffprobe.exe', 'ffplay.exe') | Where-Object { -not (Test-Path (Join-Path $dir $_)) }
if ($ffNeeded.Count -eq 0) { Write-Host 'ffmpeg / ffprobe / ffplay: present, skipped' }
else {
    Write-Host ("ffmpeg build (" + ($ffNeeded -join ', ') + "):")
    $ffZip = Join-Path $tmp 'ffmpeg.zip'
    Get-File 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip' $ffZip
    foreach ($n in $ffNeeded) {
        Copy-FromZip $ffZip ('/bin/' + [regex]::Escape($n) + '$') (Join-Path $dir $n)
        Write-Host "  extracted $n"
    }
    Remove-Item $ffZip -Force -ErrorAction SilentlyContinue
}

# 3) deno (yt-dlp uses it as the JavaScript runtime for YouTube signature solving)
$deno = Join-Path $dir 'deno.exe'
if (Test-Path $deno) { Write-Host 'deno.exe: present, skipped' }
else {
    Write-Host 'deno.exe:'
    $denoZip = Join-Path $tmp 'deno.zip'
    Get-File 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip' $denoZip
    Copy-FromZip $denoZip 'deno\.exe$' $deno
    Write-Host '  extracted deno.exe'
    Remove-Item $denoZip -Force -ErrorAction SilentlyContinue
}

# 4) WebView2 SDK DLLs (optional: HD playback inside the app)
$wv2 = @('Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.Wpf.dll', 'WebView2Loader.dll') | Where-Object { -not (Test-Path (Join-Path $dir $_)) }
if ($wv2.Count -eq 0) { Write-Host 'WebView2 DLLs: present, skipped' }
else {
    Write-Host 'WebView2 DLLs:'
    & (Join-Path $dir 'setup-webview2.ps1')
}

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

# 5) versions
Write-Host ''
Write-Host '=== Installed versions ==='
function Show-Version($label, $exe, $flag) {
    $p = Join-Path $dir $exe
    if (-not (Test-Path $p)) { Write-Host ("  {0,-8} MISSING" -f $label); return }
    $ErrorActionPreference = 'Continue'   # ffmpeg-family tools print the banner to stderr
    try {
        $out = (& $p $flag 2>&1 | Select-Object -First 1)
        Write-Host ("  {0,-8} {1}" -f $label, ("$out".Trim()))
    } catch { Write-Host ("  {0,-8} present (version check failed)" -f $label) }
}
Show-Version 'yt-dlp' 'yt-dlp.exe' '--version'
Show-Version 'ffmpeg' 'ffmpeg.exe' '-version'
Show-Version 'ffprobe' 'ffprobe.exe' '-version'
Show-Version 'ffplay' 'ffplay.exe' '-version'
Show-Version 'deno' 'deno.exe' '--version'
$wvCore = Join-Path $dir 'Microsoft.Web.WebView2.Core.dll'
if (Test-Path $wvCore) { Write-Host ("  {0,-8} {1}" -f 'WebView2', (Get-Item $wvCore).VersionInfo.FileVersion) }
else { Write-Host '  WebView2 not installed (optional)' }
Write-Host ''
Write-Host 'Done. Launch Deviload.bat (or Deviload.exe).'
Write-Host ''
pause
