#!/usr/bin/env bash
# Run as an unprivileged user with Xvfb, D-Bus and xdotool installed.
set -euo pipefail
image=$(realpath "$1")
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
cd "$work"
"$image" --appimage-extract > /dev/null
export APPIMAGE="$image"
export APPDIR="$work/squashfs-root"
export XDG_CACHE_HOME="$work/cache"
mkdir -p "$XDG_CACHE_HOME"
export GDK_BACKEND=x11
export WEBKIT_DISABLE_DMABUF_RENDERER=1
set +e
timeout 40s xvfb-run -a dbus-run-session -- bash -c '
  "$APPDIR/AppRun" > app.log 2>&1 &
  pid=$!
  trap "kill $pid 2>/dev/null || true" EXIT
  visible=0
  for attempt in $(seq 1 25); do
    kill -0 "$pid" 2>/dev/null || { cat app.log; exit 1; }
    if xdotool search --onlyvisible --name "Deviload" >/dev/null 2>&1; then visible=1; break; fi
    sleep 1
  done
  test "$visible" = 1 || { cat app.log; exit 1; }
  sleep 4
  kill -0 "$pid" 2>/dev/null || { cat app.log; exit 1; }
  cat app.log
  if grep -E "undefined symbol|autoaudiosink not found|appsink not found|Aborting|GLib-GObject-CRITICAL|Failed to load module.*(gio|gvfs)" app.log; then exit 1; fi
'
result=$?
set -e
exit "$result"
