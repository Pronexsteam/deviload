# setup-webview2.ps1 — downloads the WebView2 SDK (DLLs) into the app folder for HD in-app playback
# Run: double-click "setup-webview2.bat". Internet connection required.
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$nupkg = Join-Path $env:TEMP 'wv2.zip'
$tmp = Join-Path $env:TEMP 'wv2pkg'

Write-Host '=== WebView2 SDK setup ==='
Write-Host 'Downloading the package from nuget.org...'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri 'https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2' -OutFile $nupkg

if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive -Path $nupkg -DestinationPath $tmp -Force

Write-Host 'Copying DLLs...'
function Find-Dll($name) {
    $all = Get-ChildItem -Path $tmp -Recurse -Filter $name -ErrorAction SilentlyContinue
    # prefer the .NET Framework build (net45/net46/net462...) — that is the one Windows PowerShell can load
    $fw = $all | Where-Object { $_.FullName -match '\\lib\\net4' } | Select-Object -First 1
    if (-not $fw) { $fw = $all | Where-Object { $_.FullName -match '\\lib\\' } | Select-Object -First 1 }
    if (-not $fw) { $fw = $all | Select-Object -First 1 }
    return $fw
}
$core = Find-Dll 'Microsoft.Web.WebView2.Core.dll'
$wpf  = Find-Dll 'Microsoft.Web.WebView2.Wpf.dll'
if (-not $core -or -not $wpf) { Write-Host 'ERROR: managed DLLs not found in the package.'; if (-not $env:CI) { pause }; exit 1 }
Copy-Item $core.FullName $dir -Force
Copy-Item $wpf.FullName $dir -Force
Write-Host ("  Core: " + $core.FullName)
Write-Host ("  Wpf:  " + $wpf.FullName)

$arch = if ([Environment]::Is64BitOperatingSystem) { 'win-x64' } else { 'win-x86' }
$loader = Get-ChildItem -Path $tmp -Recurse -Filter 'WebView2Loader.dll' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\$arch\\" } | Select-Object -First 1
if (-not $loader) { $loader = Get-ChildItem -Path $tmp -Recurse -Filter 'WebView2Loader.dll' -ErrorAction SilentlyContinue | Select-Object -First 1 }
if ($loader) { Copy-Item $loader.FullName $dir -Force; Write-Host ("  Loader: " + $loader.FullName) }

# check that the WebView2 Runtime is installed (it usually is on Windows 10/11)
$rtOk = $false
foreach ($k in @('HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
                 'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}')) {
    if (Test-Path $k) { $rtOk = $true }
}

Write-Host ''
Write-Host 'DLLs installed.'
if (-not $rtOk) {
    Write-Host 'WARNING: WebView2 Runtime not found.'
    Write-Host 'Download and install the "Evergreen Bootstrapper" from:'
    Write-Host 'https://developer.microsoft.com/microsoft-edge/webview2/'
}
Write-Host 'Done. Restart Deviload — videos will open in HD via YouTube.'
Write-Host ''
if (-not $env:CI) { pause }
