// What the optional "pause while another app plays" setting does, without the page around it.
export const YIELD_KEY = "deviload-music-yield";
export function readYield(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(YIELD_KEY) || "{}");
    return { pause: value?.pause === true, resume: value?.resume === true };
  } catch {
    return { pause: false, resume: false };
  }
}

// Decides what to do when another app starts or stops sounding.
export function yieldStep(state, { otherPlaying, musicPlaying, settings }) {
  if (!settings.pause) return { ...state, yielded: false, action: null };
  if (otherPlaying) return musicPlaying ? { yielded: true, action: "pause" } : { ...state, action: null };
  if (state.yielded) return { yielded: false, action: settings.resume ? "play" : null };
  return { ...state, action: null };
}
