Third-party components bundled in the Deviload portable release
================================================================

Deviload itself: MIT (see ..\LICENSE).

yt-dlp.exe            Unlicense (public domain)      yt-dlp.LICENSE.txt
                      https://github.com/yt-dlp/yt-dlp

ffmpeg.exe,           GPL v3 (this build; FFmpeg is  ffmpeg.LICENSE.md, ffmpeg.COPYING.GPLv3.txt,
ffprobe.exe           LGPL v2.1+ with GPL parts)     ffmpeg.COPYING.LGPLv2.1.txt
                      Binaries: https://github.com/BtbN/FFmpeg-Builds, asset ffmpeg-master-latest-win64-gpl.zip
                      (static GPL build: it carries libx264, which the local MP4 convert needs; the LGPL
                      build has no x264 and is only ~19 % smaller, so it was not chosen)
                      Source:   https://github.com/FFmpeg/FFmpeg (the release page links the exact source snapshot)

deno.exe              MIT                            deno.LICENSE.txt
                      https://github.com/denoland/deno

WebView2 SDK DLLs     Microsoft Software License     WebView2.NOTICE.txt
                      https://www.nuget.org/packages/Microsoft.Web.WebView2

Deviload.exe wrapper  Microsoft Limited Public       ps2exe.LICENSE.txt
(ps2exe host stub)    License 1.1
                      https://github.com/MScholtes/PS2EXE
