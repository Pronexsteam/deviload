#!/usr/bin/env bash
# Puts yt-dlp, FFmpeg, FFprobe and Deno into ./bin for a macOS build.
# FFmpeg and Deno come as separate Apple Silicon and Intel builds; lipo joins
# them so the universal app runs on both without Homebrew.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p bin
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fetch() { curl -fsSL --retry 4 --retry-delay 10 --retry-all-errors -o "$2" "$1"; }

fetch https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_macos bin/yt-dlp

for arch in arm64 amd64; do
    for tool in ffmpeg ffprobe; do
        fetch "https://ffmpeg.martin-riedl.de/redirect/latest/macos/$arch/release/$tool.zip" "$work/$tool-$arch.zip"
        unzip -oq "$work/$tool-$arch.zip" -d "$work/$tool-$arch"
    done
done
for tool in ffmpeg ffprobe; do
    lipo -create "$work/$tool-arm64/$tool" "$work/$tool-amd64/$tool" -output "bin/$tool"
done

for target in aarch64-apple-darwin x86_64-apple-darwin; do
    fetch "https://github.com/denoland/deno/releases/latest/download/deno-$target.zip" "$work/deno-$target.zip"
    unzip -oq "$work/deno-$target.zip" -d "$work/deno-$target"
done
lipo -create "$work/deno-aarch64-apple-darwin/deno" "$work/deno-x86_64-apple-darwin/deno" -output bin/deno

chmod +x bin/yt-dlp bin/ffmpeg bin/ffprobe bin/deno
for tool in yt-dlp ffmpeg ffprobe deno; do
    printf '%-8s %s\n' "$tool" "$(lipo -archs "bin/$tool" 2>/dev/null || echo universal)"
done
