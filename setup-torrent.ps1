# setup-torrent.ps1 — ставит движок WebTorrent для просмотра торрентов. Нужен Node.js + интернет.
# Запуск: дабл-клик по "setup-torrent.bat".
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$te = Join-Path $dir 'torrent-engine'

Write-Host '=== Установка движка торрентов (WebTorrent) ==='

# проверка Node.js
$nv = $null
try { $nv = (& node --version) 2>$null } catch {}
if (-not $nv) {
    Write-Host ''
    Write-Host 'ОШИБКА: Node.js не найден.'
    Write-Host 'Поставь Node.js (LTS) с https://nodejs.org/ , перезагрузись и запусти заново.'
    Write-Host ''
    pause; exit 1
}
Write-Host "Node.js: $nv"

New-Item -ItemType Directory -Force -Path $te | Out-Null
Push-Location $te
try {
    if (-not (Test-Path (Join-Path $te 'package.json'))) {
        Write-Host 'Создаю package.json...'
        & npm init -y | Out-Null
    }
    Write-Host 'Ставлю webtorrent (нужен интернет, может занять минуту)...'
    & npm install webtorrent@1 --no-optional --no-audit --no-fund
} finally {
    Pop-Location
}

if (Test-Path (Join-Path $te 'node_modules\webtorrent')) {
    Write-Host ''
    Write-Host 'Готово! WebTorrent установлен.'
    Write-Host 'Перезапусти YT Downloader — кнопка «Смотреть торрент» заработает.'
} else {
    Write-Host ''
    Write-Host 'ОШИБКА: webtorrent не установился. Проверь интернет и повтори.'
}
Write-Host ''
pause
