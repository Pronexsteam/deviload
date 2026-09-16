Portable Windows build — unzip, run Deviload.exe. Nothing to install.

![Main window](https://raw.githubusercontent.com/Pronexsteam/deviload/main/docs/img/main-en-v2.png)

Included: Deviload.exe, yt-dlp (nightly channel), ffmpeg/ffprobe (BtbN GPL static build), deno, WebView2 SDK DLLs, licences in LICENSES/, guide in docs/ (EN and RU).

What changed in 1.1.0:
- **yt-dlp nightly**: the Update button now installs the nightly build (`--update-to nightly`) and reports the new version; once a day the app checks the bundled yt-dlp and reminds you when it is older than two weeks — nothing is downloaded until you press Update. Fresh setups (`setup.bat`) start on nightly.
- **Readable errors**: a failed queue item shows the reason in plain words — sign-in required, age check, private / members-only / geo-blocked / removed video, rate limit, missing ffmpeg or JavaScript runtime, format not available, unsupported link, network error — with a hint on hover, in both languages; the raw yt-dlp output stays under Log.
- **Queue lists** are created with `[List[object]]::new()` instead of `New-Object`.
- **Lighter zip**: ffmpeg/ffprobe come from the BtbN `win64-gpl` static build (libx264 is needed for the local MP4 convert; the LGPL build is only ~19 % smaller and has no x264); ffplay is no longer downloaded.

Highlights:
- one-click **Sign in to YouTube** (private, members-only and "confirm you're not a bot" cases; age-restricted when the account is age-verified) — no manual cookie export
- English / Russian interface, switch in the title bar
- playlists, chapters, trim, GIF from selection, MP3 320 kbps / WAV / FLAC, subtitles, SponsorBlock
- no console window; portable settings and history next to the exe

![Sign in to YouTube](https://raw.githubusercontent.com/Pronexsteam/deviload/main/docs/img/signin-window-v2.png)

Full guide with screenshots: [docs/guide-en.md](https://github.com/Pronexsteam/deviload/blob/main/docs/guide-en.md) · [docs/guide-ru.md](https://github.com/Pronexsteam/deviload/blob/main/docs/guide-ru.md)

Requires Windows 10/11 with the WebView2 Runtime (ships with Edge).
