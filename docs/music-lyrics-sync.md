# Lyrics timing

Devil Music reads LRCLIB's optional `lyricsfile` alongside the existing plain text and LRC response. The Lyricsfile 1.0 draft supplies absolute millisecond line/word starts and optional ends. No word timestamps are inferred from the text, beat or playback duration.

- Valid word timing enables a themed moving fill and soft glow, driven by the active audio element's current time. Pausing and seeking use that same clock.
- Overlapping lines retain their explicit end times. Missing word ends allow a current-word state without inventing a timed fill.
- Missing or invalid word data falls back to line timing; missing line timing falls back to plain text.
- Only an explicit instrumental flag displays “Instrumental”. Missing lyrics remain “No matching lyrics found.” The large player retains its artwork and controls.
- Reduced motion uses a static current-word highlight.

The Now Playing sidebar can flip between its cover and embedded lyrics. The same lyrics controller and cache move into the full player and return to the sidebar when it closes; both views use the active audio element's clock and the same line/word rendering. Sidebar scrolling stays inside the card. Reduced motion disables the flip transition.

The request remains anonymous and bounded to 256 KiB. Optional YAML is parsed into a fixed-depth schema; supported output is limited to 3,000 lines, 500 words per line and a 24-hour timestamp range. Word text must reconstruct its complete line, preserving spaces. Unsupported or malformed files cannot break ordinary LRC playback.

Sources: [LRCLIB API](https://lrclib.net/docs), [Lyricsfile specification](https://github.com/tranxuanthang/lyricsfile/blob/main/SPECIFICATION.md).

Coverage: Rust response-normalization tests; JavaScript timing tests for gaps, overlap, backward seeking and absent ends; browser checks for five themes and all fallback states. Word timing availability depends on the individual LRCLIB record.
