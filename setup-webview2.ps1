# setup-webview2.ps1 — скачивает WebView2 SDK (DLL) в папку для HD-просмотра
# Запуск: дабл-клик по "setup-webview2.bat". Нужен интернет.
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$nupkg = Join-Path $env:TEMP 'wv2.zip'
$tmp = Join-Path $env:TEMP 'wv2pkg'

Write-Host '=== Установка WebView2 SDK ==='
Write-Host 'Скачиваю пакет с nuget.org...'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri 'https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2' -OutFile $nupkg

if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive -Path $nupkg -DestinationPath $tmp -Force

Write-Host 'Копирую DLL...'
function Find-Dll($name) {
    $all = Get-ChildItem -Path $tmp -Recurse -Filter $name -ErrorAction SilentlyContinue
    # сначала ищем версию для .NET Framework (net45/net46/net462...), её грузит Windows PowerShell
    $fw = $all | Where-Object { $_.FullName -match '\\lib\\net4' } | Select-Object -First 1
    if (-not $fw) { $fw = $all | Where-Object { $_.FullName -match '\\lib\\' } | Select-Object -First 1 }
    if (-not $fw) { $fw = $all | Select-Object -First 1 }
    return $fw
}
$core = Find-Dll 'Microsoft.Web.WebView2.Core.dll'
$wpf  = Find-Dll 'Microsoft.Web.WebView2.Wpf.dll'
if (-not $core -or -not $wpf) { Write-Host 'ОШИБКА: не нашёл управляемые DLL в пакете.'; pause; exit 1 }
Copy-Item $core.FullName $dir -Force
Copy-Item $wpf.FullName $dir -Force
Write-Host ("  Core: " + $core.FullName)
Write-Host ("  Wpf:  " + $wpf.FullName)

$arch = if ([Environment]::Is64BitOperatingSystem) { 'win-x64' } else { 'win-x86' }
$loader = Get-ChildItem -Path $tmp -Recurse -Filter 'WebView2Loader.dll' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\$arch\\" } | Select-Object -First 1
if (-not $loader) { $loader = Get-ChildItem -Path $tmp -Recurse -Filter 'WebView2Loader.dll' -ErrorAction SilentlyContinue | Select-Object -First 1 }
if ($loader) { Copy-Item $loader.FullName $dir -Force; Write-Host ("  Loader: " + $loader.FullName) }

# проверка наличия среды выполнения WebView2 (обычно стоит на Win10/11)
$rtOk = $false
foreach ($k in @('HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
                 'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}')) {
    if (Test-Path $k) { $rtOk = $true }
}

Write-Host ''
Write-Host 'DLL установлены.'
if (-not $rtOk) {
    Write-Host 'ВНИМАНИЕ: среда WebView2 Runtime не найдена.'
    Write-Host 'Скачай и поставь "Evergreen Bootstrapper" отсюда:'
    Write-Host 'https://developer.microsoft.com/microsoft-edge/webview2/'
}
Write-Host 'Готово. Перезапусти YT Downloader — видео будет открываться в HD через YouTube.'
Write-Host ''
pause
