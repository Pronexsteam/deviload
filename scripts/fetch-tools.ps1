# Downloads yt-dlp, FFmpeg/FFprobe and Deno into .\bin (Windows x64).
# Existing files are kept unless -Force is given.
param([switch]$Force)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $root 'bin'
New-Item -ItemType Directory -Force $bin | Out-Null
$temp = Join-Path ([IO.Path]::GetTempPath()) ("deviload-tools-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force $temp | Out-Null

function Need($name) { $Force -or -not (Test-Path (Join-Path $bin $name)) }

function Get-File($url, $target) {
    # GitHub release downloads fail now and then with a server error; try again before giving up.
    for ($attempt = 1; $attempt -le 4; $attempt++) {
        Write-Host "Downloading $url"
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $target
            return
        } catch {
            if ($attempt -eq 4) { throw }
            Write-Host "Download failed ($($_.Exception.Message.Split([Environment]::NewLine)[0])), retrying in $($attempt * 10) s"
            Start-Sleep -Seconds ($attempt * 10)
        }
    }
}

try {
    if (Need 'yt-dlp.exe') {
        # Nightly builds follow YouTube changes faster than the stable channel.
        Get-File 'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp.exe' (Join-Path $bin 'yt-dlp.exe')
    }
    if ((Need 'ffmpeg.exe') -or (Need 'ffprobe.exe')) {
        $zip = Join-Path $temp 'ffmpeg.zip'
        Get-File 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip' $zip
        Expand-Archive -Path $zip -DestinationPath (Join-Path $temp 'ffmpeg') -Force
        foreach ($name in 'ffmpeg.exe', 'ffprobe.exe') {
            $file = Get-ChildItem -Path (Join-Path $temp 'ffmpeg') -Recurse -Filter $name | Select-Object -First 1
            Copy-Item $file.FullName (Join-Path $bin $name) -Force
        }
    }
    if (Need 'deno.exe') {
        $zip = Join-Path $temp 'deno.zip'
        Get-File 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip' $zip
        Expand-Archive -Path $zip -DestinationPath $bin -Force
    }
} finally {
    Remove-Item -Recurse -Force $temp -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ('yt-dlp  ' + (& (Join-Path $bin 'yt-dlp.exe') --version))
Write-Host ('ffmpeg  ' + ((& (Join-Path $bin 'ffmpeg.exe') -version | Select-Object -First 1) -replace '^ffmpeg version ', ''))
Write-Host ('deno    ' + ((& (Join-Path $bin 'deno.exe') --version | Select-Object -First 1) -replace '^deno ', ''))
