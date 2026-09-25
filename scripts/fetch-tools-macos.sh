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

fetch https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_macos bin/yt-dlp
check bin/yt-dlp https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/SHA2-256SUMS yt-dlp_macos

for arch in arm64 amd64; do
    for tool in ffmpeg ffprobe; do
        # "latest" redirects to one build (its server answers a one-byte GET, not HEAD); the checksum sits next to it.
        url="$(curl -fsSL -r 0-0 --retry 4 --retry-delay 10 -o /dev/null -w '%{url_effective}' "https://ffmpeg.martin-riedl.de/redirect/latest/macos/$arch/release/$tool.zip")"
        fetch "$url" "$work/$tool-$arch.zip"
        check "$work/$tool-$arch.zip" "$url.sha256"
        unzip -oq "$work/$tool-$arch.zip" -d "$work/$tool-$arch"
    done
done
for tool in ffmpeg ffprobe; do
    lipo -create "$work/$tool-arm64/$tool" "$work/$tool-amd64/$tool" -output "bin/$tool"
done

for target in aarch64-apple-darwin x86_64-apple-darwin; do
    fetch "https://github.com/denoland/deno/releases/latest/download/deno-$target.zip" "$work/deno-$target.zip"
    check "$work/deno-$target.zip" "https://github.com/denoland/deno/releases/latest/download/deno-$target.zip.sha256sum"
    unzip -oq "$work/deno-$target.zip" -d "$work/deno-$target"
done
lipo -create "$work/deno-aarch64-apple-darwin/deno" "$work/deno-x86_64-apple-darwin/deno" -output bin/deno

chmod +x bin/yt-dlp bin/ffmpeg bin/ffprobe bin/deno
for tool in yt-dlp ffmpeg ffprobe deno; do
    printf '%-8s %s\n' "$tool" "$(lipo -archs "bin/$tool" 2>/dev/null || echo universal)"
done
