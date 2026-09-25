#!/usr/bin/env bash
# Puts yt-dlp, FFmpeg, FFprobe and Deno into ./bin for a Linux x86_64 build.
# All four are self-contained builds, so the packages need no system FFmpeg.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p bin
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fetch() { curl -fsSL --retry 4 --retry-delay 10 --retry-all-errors -o "$2" "$1"; }

# Nightly builds follow YouTube changes faster than the stable channel.
fetch https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_linux bin/yt-dlp

fetch https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-linux64-gpl.tar.xz "$work/ffmpeg.tar.xz"
tar -xJf "$work/ffmpeg.tar.xz" -C "$work"
cp "$work"/ffmpeg-master-latest-linux64-gpl/bin/ffmpeg "$work"/ffmpeg-master-latest-linux64-gpl/bin/ffprobe bin/

fetch https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip "$work/deno.zip"
unzip -oq "$work/deno.zip" -d bin

chmod +x bin/yt-dlp bin/ffmpeg bin/ffprobe bin/deno
echo "yt-dlp  $(bin/yt-dlp --version)"
echo "ffmpeg  $(bin/ffmpeg -version | head -n 1 | sed 's/^ffmpeg version //')"
echo "deno    $(bin/deno --version | head -n 1 | sed 's/^deno //')"
