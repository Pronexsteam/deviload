# Ambient theme

Ambient uses the existing dark layout and adds three soft artwork light regions behind the bottom music controls. The browser blurs the current cover directly: no image pixel service, palette API, microphone permission or extra music engine is involved.

Ambient is the default for new profiles, unavailable storage, invalid preferences and the retired Classic theme. Explicitly selected supported themes remain unchanged. The first-paint bootstrap and runtime use the same rule. Without a playing cover the interface keeps its restrained dark surfaces.

Upper panels, the sidebar and central workspace share a blurred artwork wash and translucent dark surfaces. Its intensity follows the same audio envelope at lower gain than the dock. Cover changes crossfade; reduced motion and pause retain static light. The mini-player receives the main player's three audio levels through targeted local window events, without another audio source or analyser. It uses the same light rendering and preserves its native rounded boundary.

`music-sound.js` owns both audio decks' existing Web Audio graph. Each deck gains one optional analyser side branch after sound processing, while its single speaker connection remains intact. Theme switching reuses the graph and never creates another media-element source.

The light reads bass (35–180 Hz), mid (180–2200 Hz), treble (2200–9000 Hz), and waveform RMS. A bass onset envelope uses a fast attack and slower release. There is no random pulse, clock-driven beat, or assumed BPM. The response reflects the actual audio signal; it is not a musical beat-grid detector.

Rendering is limited to roughly 30 updates per second. Paused, buffered, muted, and reduced-motion states retain a static artwork glow. Sampling stops when the main player is hidden unless the mini-player is open. Unsupported analysis also leaves a static glow. Other themes do not start analysis. The mini-player resets stale light frames and respects its own reduced-motion preference.

Validation uses generated PCM bass/treble pulses through real browser media elements and Web Audio, plus silence/pause/reduced-motion checks, source-reuse checks, and responsive layout checks.
