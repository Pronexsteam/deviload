import { TRANSITIONS } from "./music-transition-model.js";
export const frequencies = [60, 170, 350, 1000, 3500, 10000];
export const presets = {
  flat: [0, 0, 0, 0, 0, 0],
  bass: [5, 3, 0, -1, 0, 1],
  voice: [-3, -2, 1, 3, 2, 0],
  night: [-2, -1, 0, 1, -1, -3],
};
// Sound moods. Slowed and Nightcore change speed and pitch together, the way those edits are made; 8D circles
// the song around the listener's head. [shift] multiplies the speed, [reverb] is the wet share, [orbit] the
// seconds one turn takes.
export const VIBES = {
  slowed: { shift: 0.85, reverb: 0.5, orbit: 0 },
  nightcore: { shift: 1.25, reverb: 0, orbit: 0 },
  "8d": { shift: 1, reverb: 0.22, orbit: 8 },
};
export const vibeOf = key => (Object.hasOwn(VIBES, key) ? VIBES[key] : null);
const gains = value =>
  frequencies.map((_, i) => (Number.isFinite(value?.[i]) ? Math.max(-12, Math.min(12, value[i])) : 0));
export function soundSettings(raw = {}) {
  raw = raw && typeof raw === "object" ? raw : {};
  const custom = Array.isArray(raw.custom)
    ? raw.custom
        .filter(p => p && typeof p.name === "string" && p.name.trim())
        .slice(0, 50)
        .map(p => ({ name: p.name.trim().slice(0, 48), bands: gains(p.bands) }))
    : [];
  const preset = Object.hasOwn(presets, raw.preset) ? raw.preset : "custom";
  return {
    preset: preset === "custom" && !Array.isArray(raw.bands) ? "flat" : preset,
    bands: gains(raw.bands || presets[preset]),
    custom,
    selected: custom.some(p => p.name === raw.selected) ? raw.selected : "",
    bypass: raw.bypass === true,
    soft: raw.soft === true,
    level: raw.level === true,
    transition: TRANSITIONS.includes(raw.transition) ? raw.transition : 0,
    seamless: raw.seamless !== false,
    skipSilence: raw.skipSilence === true,
    skipSegments: raw.skipSegments === true,
    rate: Number.isFinite(raw.rate) ? Math.round(Math.max(0.5, Math.min(2, raw.rate)) * 20) / 20 : 1,
    vibe: vibeOf(raw.vibe) ? raw.vibe : "",
  };
}
// RBJ peaking response for the same Q and frequencies as the Web Audio graph.
// Include overlapping boosts; using only the largest slider gain underestimates them.
export function equalizerHeadroom(bands, sampleRate = 48000) {
  const filters = frequencies.map((f, i) => {
    const a = 10 ** (bands[i] / 40),
      w = (2 * Math.PI * Math.min(f, sampleRate * 0.49)) / sampleRate,
      alpha = Math.sin(w) / 1.4,
      c = Math.cos(w);
    return { b: [1 + alpha * a, -2 * c, 1 - alpha * a], a: [1 + alpha / a, -2 * c, 1 - alpha / a] };
  });
  let peak = 1;
  for (let i = 0; i <= 1024; i++) {
    const w = (Math.PI * i) / 1024,
      c = Math.cos(w),
      s = Math.sin(w),
      c2 = Math.cos(2 * w),
      s2 = Math.sin(2 * w);
    let response = 1;
    for (const f of filters) {
      const power = v => (v[0] + v[1] * c + v[2] * c2) ** 2 + (v[1] * s + v[2] * s2) ** 2;
      response *= Math.sqrt(power(f.b) / power(f.a));
    }
    peak = Math.max(peak, response);
  }
  return peak > 1.00001 ? 1 / (peak * 10 ** (0.5 / 20)) : 1;
}
export function createMusicRate(nodes, getRate, getVibe = () => null) {
  const fast = new WeakMap();
  let mode = "";
  const pitchSupported = nodes.every(
    node => "preservesPitch" in node || "webkitPreservesPitch" in node || "mozPreservesPitch" in node,
  );
  function apply(node) {
    // A listening room keeps normal time, so a mood that changes speed keeps only its sound there.
    const shift = mode ? 1 : (getVibe()?.shift ?? 1);
    for (const key of ["preservesPitch", "webkitPreservesPitch", "mozPreservesPitch"])
      if (key in node) node[key] = shift === 1;
    // Guest synchronization owns playbackRate, including its drift correction.
    if (mode === "guest") {
      node.defaultPlaybackRate = 1;
      return;
    }
    const rate = Math.round((mode || !pitchSupported ? 1 : getRate()) * shift * 1000) / 1000;
    // Silence has no pitch to preserve, so it may pass faster even where pitch correction is missing.
    node.playbackRate = (!mode && fast.get(node)) || rate;
    node.defaultPlaybackRate = rate;
  }
  for (const node of nodes)
    node.addEventListener("loadedmetadata", () => {
      fast.delete(node);
      apply(node);
    });
  return {
    pitchSupported,
    get mode() {
      return mode;
    },
    setSource(node) {
      fast.delete(node);
      apply(node);
    },
    // A temporary rate for a silent stretch; 0 returns the node to the chosen speed.
    hurry(node, rate) {
      if (rate) fast.set(node, rate);
      else fast.delete(node);
      apply(node);
    },
    setMode(value) {
      mode = value;
      nodes.forEach(apply);
    },
    refresh() {
      nodes.forEach(apply);
    },
    reason() {
      return mode ? "room" : !pitchSupported ? "pitch" : "";
    },
  };
}
// A room-like tail made from decaying noise, darker as it fades, so no recording has to ship with the app.
export function reverbTail(sampleRate, seconds = 2.6, random = Math.random) {
  const length = Math.max(1, Math.round(sampleRate * seconds)),
    channels = [new Float32Array(length), new Float32Array(length)],
    delay = Math.round(sampleRate * 0.012);
  for (const data of channels) {
    let smooth = 0;
    for (let i = delay; i < length; i++) {
      const at = (i - delay) / (length - delay),
        dark = 0.15 + 0.8 * at;
      smooth += (random() * 2 - 1 - smooth) * (1 - dark);
      data[i] = smooth * (1 - at) ** 3;
    }
  }
  return channels;
}
// Silence is played through quickly rather than cut, so a song that returns after a pause loses nothing
// but the few milliseconds it takes to hear it. Short breaths between phrases stay untouched.
export const SILENCE = { level: 0.0015, hold: 0.8, rate: 4 };
export function createSilenceWatch({ level = SILENCE.level, hold = SILENCE.hold } = {}) {
  let quietSince = null;
  return {
    // rms of the current output already divided by the player volume; seconds from any monotonic clock.
    update(rms, now, listening) {
      if (!listening || !(rms < level)) {
        quietSince = null;
        return false;
      }
      quietSince ??= now;
      return now - quietSince >= hold;
    },
    reset() {
      quietSince = null;
    },
  };
}
