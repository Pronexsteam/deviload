"""Check SquashFS metadata, which extraction as the current user can hide."""
import re
import subprocess
import sys

image = sys.argv[1]
offset = subprocess.check_output([image, "--appimage-offset"], text=True).strip()
if not offset.isdecimal():
    raise SystemExit("Invalid AppImage filesystem offset")
listing = subprocess.check_output(["unsquashfs", "-lln", "-o", offset, image], text=True)
required = {"squashfs-root/AppRun", "squashfs-root/AppRun.wrapped", "squashfs-root/usr/bin/deviload"}
found = set()
for line in listing.splitlines():
    match = re.match(r"^([dl-][rwxstST-]{9})\s+\S+\s+\d+\s+\S+\s+\S+\s+(.+)$", line)
    if not match:
        continue
    mode, path = match.groups()
    if path in required:
        if mode != "-rwxr-xr-x":
            raise SystemExit(f"Unsafe or non-public launcher permissions: {path}: {mode}; expected 0755")
        found.add(path)
if found != required:
    raise SystemExit(f"Missing AppImage launchers: {sorted(required - found)}")
print("AppImage launchers have mode 0755 in the packaged SquashFS.")
