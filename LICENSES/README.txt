Third-party components shipped with the Deviload portable build
===============================================================

Deviload itself: MIT (see ..\LICENSE.txt).

bin\yt-dlp.exe        Unlicense (public domain)      yt-dlp.LICENSE.txt
                      https://github.com/yt-dlp/yt-dlp

bin\ffmpeg.exe,       GPL v3 (this build; FFmpeg is  ffmpeg.LICENSE.md, ffmpeg.COPYING.GPLv3.txt,
bin\ffprobe.exe       LGPL v2.1+ with GPL parts)     ffmpeg.COPYING.LGPLv2.1.txt
                      Binaries: https://github.com/BtbN/FFmpeg-Builds, asset ffmpeg-master-latest-win64-gpl.zip
                      (the GPL build carries libx264, which Devil Cut uses for MP4 export)
                      Source:   https://github.com/FFmpeg/FFmpeg (the release page links the exact source snapshot)

bin\deno.exe          MIT                            deno.LICENSE.txt
                      https://github.com/denoland/deno

Components compiled into Deviload.exe
-------------------------------------

Tauri and the Rust crates it depends on   MIT or Apache-2.0   https://tauri.app
Phosphor Icons (selected SVGs)            MIT                 https://phosphoricons.com
Simple Icons (service logos)              CC0-1.0             https://simpleicons.org
QRCode.js                                 MIT                 https://github.com/davidshimjs/qrcodejs
Inter typeface (Latin and Cyrillic)       OFL-1.1             https://rsms.me/inter   inter.OFL.txt

The Microsoft Edge WebView2 Runtime is part of Windows 10 and 11 and is not
shipped with Deviload. It can be installed from
https://developer.microsoft.com/microsoft-edge/webview2/ if it is missing.

Optional gallery engine (installed separately on request)
--------------------------------------------------------

engines\gallery-dl.exe / engines/gallery-dl  GNU GPL v2
                      gallery-dl.COPYING.GPLv2.txt
                      Version: 1.32.17
                      Official project: https://codeberg.org/mikf/gallery-dl
                      Release: https://codeberg.org/mikf/gallery-dl/releases/tag/v1.32.17
                      Corresponding source: https://codeberg.org/mikf/gallery-dl/archive/v1.32.17.tar.gz
                      This separate executable is optional and is not compiled into Deviload.

Optional listening-room helper (downloaded on first host creation)
cloudflared 2026.10.3 -- Apache-2.0, cloudflared.LICENSE.txt
https://github.com/cloudflare/cloudflared/releases/tag/2026.10.3
