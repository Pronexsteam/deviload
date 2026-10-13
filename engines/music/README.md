# Devil Music playback engine

The Rust host launches a persistent, sandboxed Deno worker when Devil Music opens. An account-free IOS client supplies the opening MiB of AAC audio. The WEB/SABR session and guest video-bound PO token prepare the continuation concurrently. The continuation must match the content length and every opening byte. A bounded yt-dlp reserve is used only for transient failures, never for account restrictions or HTTP 403/429.

Audio streams to disk, not an expanding memory buffer. Completed audio is reused across restarts with a 200 MiB LRU budget. Partial files are never indexed and are removed on the next startup. A single prepared next track holds its opening buffer until activated. Foreground generation numbers prevent a late request from overriding a newer selection. Configured proxies retain the existing yt-dlp path.

## Build and test

Dependencies are pinned by `deno.lock`. Fetch the repository's Deno binary first, then run:

```sh
npm run build:music-engine
bin/deno test --allow-read --allow-write engines/music/storage.test.ts
bin/deno check --config engines/music/deno.json engines/music/engine.ts
cargo test --manifest-path src-tauri/Cargo.toml music_engine
```

On Windows use `bin/deno.exe`. The build script embeds all npm code and licenses; installed users do not need Node, npm, or internet module imports. Commit `src-tauri/music-engine/payload.json.gz` alongside changes to the engine source. The uncompressed intermediate bundles are ignored. The Deno binary is still supplied with Deviload.

## Separate signed updates

Increment `MUSIC_ENGINE_VERSION` when building an independent engine update, then run `node scripts/package-music-engine.mjs` with the existing `TAURI_SIGNING_PRIVATE_KEY` and optional password environment variable. This produces `dist/music-engine.json` locally and publishes nothing. The envelope signs the compressed payload, including its numeric version and protocol. The public key is the same as the application updater key.

The application checks the fixed `updates/music-engine.json` feed only from the playback settings button. A missing feed is reported as unpublished. Updates are size bounded, signature verified, and staged atomically for the next restart. Code is verified against the signed envelope again before each process launch. A startup failure restores the previous signed package, falling back to the bundled engine. Updates do not interrupt current playback. Publishing the first feed and testing it on released Linux/macOS builds remain release steps.

The PO helper derives from LuanRT/GoogleVideo's MIT-licensed example; its untrusted player interpreter has no filesystem, environment, process or network permissions. The guest token worker can read only its bundled code and contact the listed YouTube/Google endpoints. The host strips inherited credentials from the worker environment. Signed media URLs and guest tokens are not written to the audio cache or diagnostics.

Upstream services and networks can still reject or delay playback. Local latency measurements are not a guarantee for every track, location or future YouTube change.
