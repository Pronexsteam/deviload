# Builds the Windows installer and a portable zip into .\dist.
# Run scripts\fetch-tools.ps1 first so .\bin holds the engines.
param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

foreach ($name in 'yt-dlp.exe', 'ffmpeg.exe', 'ffprobe.exe', 'deno.exe') {
    if (-not (Test-Path (Join-Path $root "bin\$name"))) { throw "bin\$name is missing; run scripts\fetch-tools.ps1" }
}
# The installer is signed for in-app updates. The private key is never committed:
# it comes from the environment (CI), DEVILOAD_UPDATER_KEY, the ignored keys folder or ~/.tauri.
if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
    $candidates = @($env:DEVILOAD_UPDATER_KEY, (Join-Path $root 'keys\deviload-updater.key'), (Join-Path $HOME '.tauri\deviload-updater.key'))
    $keyFile = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if (-not $keyFile) { throw 'Updater signing key not found (see README, Releases)' }
    $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content $keyFile -Raw).Trim()
    if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -and (Test-Path "$keyFile.password")) {
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content "$keyFile.password" -Raw).Trim()
    }
}
if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) { throw 'The updater key password is missing: set TAURI_SIGNING_PRIVATE_KEY_PASSWORD or keep <key>.password next to the key' }
if (-not $SkipBuild) {
    npm run tauri build
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed with exit code $LASTEXITCODE" }
}

$release = Join-Path $root 'src-tauri\target\release'
$exe = Join-Path $release 'deviload.exe'
if (-not (Test-Path $exe)) { throw "Release build not found: $exe" }
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null

$installer = Get-ChildItem (Join-Path $release 'bundle\nsis') -Filter '*-setup.exe' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
if ($installer) {
    $setup = Join-Path $dist "Deviload-$version-setup.exe"
    Copy-Item $installer.FullName $setup -Force
    Write-Host ("{0}  {1:N1} MB" -f $setup, ((Get-Item $setup).Length / 1MB))
    # latest.json is the update feed; upload it to the release together with the installer.
    $sig = "$($installer.FullName).sig"
    if (-not (Test-Path $sig)) { throw "Updater signature not found: $sig" }
    $tag = "v$version"
    $feed = [ordered]@{
        version = $version
        notes = "https://github.com/Pronexsteam/deviload/releases/tag/$tag"
        pub_date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        platforms = [ordered]@{
            'windows-x86_64' = [ordered]@{
                signature = (Get-Content $sig -Raw).Trim()
                url = "https://github.com/Pronexsteam/deviload/releases/download/$tag/Deviload-$version-setup.exe"
            }
        }
    }
    [IO.File]::WriteAllText((Join-Path $dist 'latest.json'), ($feed | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding $false))
    Write-Host (Join-Path $dist 'latest.json')
}

$folder = Join-Path $dist 'Deviload'
if (Test-Path $folder) { Remove-Item -Recurse -Force $folder }
New-Item -ItemType Directory -Force (Join-Path $folder 'bin') | Out-Null
Copy-Item $exe (Join-Path $folder 'Deviload.exe')
foreach ($name in 'yt-dlp.exe', 'ffmpeg.exe', 'ffprobe.exe', 'deno.exe') {
    Copy-Item (Join-Path $root "bin\$name") (Join-Path $folder "bin\$name")
}
Copy-Item (Join-Path $root 'LICENSE') (Join-Path $folder 'LICENSE.txt')
Copy-Item -Recurse (Join-Path $root 'LICENSES') (Join-Path $folder 'LICENSES')

$zip = Join-Path $dist "Deviload-$version-windows-x64-portable.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path (Join-Path $folder '*') -DestinationPath $zip -CompressionLevel Optimal
Write-Host ("{0}  {1:N1} MB" -f $zip, ((Get-Item $zip).Length / 1MB))
