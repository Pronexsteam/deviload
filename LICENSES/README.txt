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

The Microsoft Edge WebView2 Runtime is part of Windows 10 and 11 and is not
shipped with Deviload. It can be installed from
https://developer.microsoft.com/microsoft-edge/webview2/ if it is missing.
