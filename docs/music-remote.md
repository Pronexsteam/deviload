# Local music remote

The remote-control icon in the music player starts an independent LAN HTTP listener and shows a QR code. It does not start or reuse the file-transfer session. The computer and phone must share a reachable local network, Deviload must remain running, and the firewall must allow private-network access. No hosted service, account, router port forwarding, audio upload or phone installation is used.

The phone opens a browser controller with artwork, track metadata, play/pause, previous/next, repeat, shuffle, mute, volume and seeking. Audio stays on the computer. All six themes and the interface language follow the desktop. Ambient uses cover colors on the phone; the phone does not analyse or play audio.

The desktop issues a fresh 256-bit random bearer in the URL fragment. The browser sends it in a header to bounded state/action endpoints. The server binds only the selected private/link-local interface, validates Host and Origin, exposes an explicit static asset allowlist, rejects unknown commands and out-of-range values, and deduplicates retried command IDs. Its CSP forbids framing, external scripts and arbitrary network destinations. No profile files, cookies, download endpoints or media URLs are exposed. HTTP is intended for a trusted LAN, not a public internet service.

Turning the remote off revokes its token and listener; restarting issues a new QR. An unused session expires after 30 minutes. The controller reports disconnection and cannot act on playback after revocation. File-transfer links remain separate.

Automated checks cover HTTP authorization, Origin, revocation, duplicate commands and bounded actions. Browser/native checks cover desktop control delivery, theme propagation and mobile layout. Testing on a physical phone and its actual Wi-Fi/firewall remains a device-specific validation step.
