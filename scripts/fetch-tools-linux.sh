#!/usr/bin/env bash
# Puts yt-dlp, FFmpeg, FFprobe and Deno into ./bin for a Linux x86_64 build.
# All four are self-contained builds, so the packages need no system FFmpeg.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p bin
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fetch() { curl -fsSL --retry 4 --retry-delay 10 --retry-all-errors -o "$2" "$1"; }

# Every download is checked against the SHA-256 its own project publishes. A mismatch deletes the
# file and stops the build, so nothing unverified reaches a release. The third argument names the
# file in a list of checksums; without it the checksum file holds just the one.
check() {
    local file="$1" sums="$2" name="${3:-}" list expected actual
    list="$(curl -fsSL --retry 4 --retry-delay 10 --retry-all-errors "$sums" | tr -d '\r')"
    if [ -n "$name" ]; then
        expected="$(printf '%s\n' "$list" | awk -v n="$name" '{ f = $2; sub(/^\*/, "", f) } f == n { print tolower($1); exit }')"
    else
        expected="$(printf '%s\n' "$list" | grep -oiE '[0-9a-f]{64}' | head -n 1 | tr 'A-F' 'a-f')"
    fi
    if [ -z "$expected" ]; then echo "No checksum for ${name:-$file} in $sums" >&2; exit 1; fi
    actual="$( (sha256sum "$file" 2>/dev/null || shasum -a 256 "$file") | cut -d' ' -f1)"
    if [ "$actual" != "$expected" ]; then
        rm -f "$file"
        echo "Checksum mismatch for ${name:-$file}: expected $expected, got $actual" >&2
        exit 1
    fi
    echo "checked  ${name:-$(basename "$file")}"
}

# Nightly builds follow YouTube changes faster than the stable channel.
fetch https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_linux bin/yt-dlp
check bin/yt-dlp https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/SHA2-256SUMS yt-dlp_linux

fetch https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz "$work/ffmpeg.tar.xz"
check "$work/ffmpeg.tar.xz" https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/checksums.sha256 ffmpeg-master-latest-linux64-gpl.tar.xz
tar -xJf "$work/ffmpeg.tar.xz" -C "$work"
cp "$work"/ffmpeg-master-latest-linux64-gpl/bin/ffmpeg "$work"/ffmpeg-master-latest-linux64-gpl/bin/ffprobe bin/

fetch https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip "$work/deno.zip"
check "$work/deno.zip" https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip.sha256sum
unzip -oq "$work/deno.zip" -d bin

chmod +x bin/yt-dlp bin/ffmpeg bin/ffprobe bin/deno
echo "yt-dlp  $(bin/yt-dlp --version)"
echo "ffmpeg  $(bin/ffmpeg -version | head -n 1 | sed 's/^ffmpeg version //')"
echo "deno    $(bin/deno --version | head -n 1 | sed 's/^deno //')"
