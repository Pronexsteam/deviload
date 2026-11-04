# Public Spotify playlist import

The desktop command `music_import_spotify_playlist` starts a short-lived, sandboxed Deno metadata reader (`src-tauri/spotify-import.mjs`). It uses the bundled runtime and does not install Python, start yt-dlp, or use the playback worker. Albums retain the existing explicitly partial embed reader.

The adapter independently implements the public web-player request protocol studied in SpotAPI and spotDL. No external Python source is shipped. It reads Spotify's public script text to discover a query hash; it never executes downloaded scripts. Anonymous session credentials live only in the subprocess, never in the output or user profile. The public client configuration dictionary comes from `code.thetadev.de/ThetaDev/spotify-secrets`; this is a third-party availability dependency, not user account credentials. Only these data hosts and the four required Spotify hosts are permitted. No sign-in, user cookies, DRM, or audio access is involved.

Every page is read sequentially against the reported total. Missing pages, changed totals, rate limits, bad response shapes, and byte/time budgets fail explicitly rather than labeling a preview complete. Unavailable tracks retain their Spotify URI in the staging report. The source item count is distinct from usable/deduplicated songs. Different Spotify IDs survive matching and draft persistence even when titles and artists are identical. If two source recordings resolve to the same YouTube video, the existing destination library still deduplicates that video.

This is an unofficial metadata interface and Spotify may change it. Full playlist access is verified locally, but is not promised for private or restricted playlists. The importer does not silently fall back to the 100-song embed on failure. Public playlist links are the main UI path; files remain optional.

Validation: `node --test tests/spotify-public-import.test.js` and the complete frontend suite. Opt-in live native check: `DEVILOAD_LIVE_IMPORT_TEST=1 cargo test --lib live_spotify_full_playlist_import -- --ignored --nocapture`. Never run network tests automatically in CI.
