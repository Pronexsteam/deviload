// Paint the same range track in all three players, including values updated by
// playback rather than user input. Never dispatch an input or change volume.
const selector =
  '.music-dock input[type="range"],.music-stage input[type="range"],.music-mini-page input[type="range"]';
const clocks = new WeakMap(),
  dragging = new Set();
export const isRangeDragging = input => dragging.has(input);
// `live` tells whether a range moves on its own clock without a player in this page (the mini player follows
// the main window); while it says so the loop keeps running.
const lives = new Set();
export function registerPlaybackRange(input, read, live) {
  clocks.set(input, read);
  if (live) lives.add(live);
}
export const wakePlaybackRanges = () => wake();
export function paintPlaybackRange(input) {
  const min = Number(input.min) || 0,
    max = Number(input.max) || 100,
    value = Number(input.value) || 0;
  const fraction = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0,
    progress = (fraction * 100).toFixed(4) + "%";
  // Native thumbs travel between half-thumb insets, not the full track width.
  const fill = `calc(${progress} + ${(0.5 - fraction).toFixed(6)} * var(--player-thumb-size, 10px))`;
  if (input.style.getPropertyValue("--range-progress") !== progress)
    input.style.setProperty("--range-progress", progress);
  if (input.style.getPropertyValue("--range-fill") !== fill) input.style.setProperty("--range-fill", fill);
  // The timeline's glow and light follow the play position.
  const seek = input.parentElement?.classList.contains("music-liquid") ? input.parentElement : null;
  if (seek && seek.style.getPropertyValue("--range-fill") !== fill)
    seek.style.setProperty("--range-fill", fill);
}
const paint = paintPlaybackRange;
document.addEventListener("input", event => {
  if (event.target.matches(selector)) paint(event.target);
});
document.addEventListener("pointerdown", event => {
  if (event.target.matches(selector)) {
    dragging.add(event.target);
    wake();
  }
});
for (const event of ["pointerup", "pointercancel", "blur"])
  window.addEventListener(event, () => {
    dragging.clear();
    // One more frame puts the slider back on the playing position.
    wake();
  });
// Moving the same controls between the dock and modal changes membership, but
// playback timestamps and CSS animations do not. Avoid a document-wide selector
// on every frame; text-only updates must not invalidate the cached controls.
let frame = 0,
  ranges = [],
  dirty = true;
const observer = new MutationObserver(records => {
  if (
    records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1))
  ) {
    dirty = true;
    wake();
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });
function tick() {
  frame = 0;
  if (document.hidden) return;
  if (dirty) {
    ranges = [...document.querySelectorAll(selector)];
    dirty = false;
  }
  ranges.forEach(input => {
    if (!input.isConnected) return;
    const read = clocks.get(input);
    if (read && !dragging.has(input)) {
      const value = read();
      if (Number.isFinite(value)) input.value = String(value);
    }
    paint(input);
  });
  // Only while something plays or a slider is held: a paused player costs no frames.
  if (
    dragging.size ||
    [...active].some(media => !media.paused && !media.ended) ||
    [...lives].some(live => live())
  )
    frame = requestAnimationFrame(tick);
}
function wake() {
  if (!frame && !document.hidden) frame = requestAnimationFrame(tick);
}
// The players that play, kept by their own events (which do not bubble, so they are caught on the way down)
// instead of searching the page on every frame. Any change of a player wakes the loop for at least one frame.
const active = new Set();
for (const name of ["play", "playing"])
  document.addEventListener(
    name,
    event => {
      active.add(event.target);
      wake();
    },
    true,
  );
for (const name of ["pause", "ended", "emptied"])
  document.addEventListener(
    name,
    event => {
      active.delete(event.target);
      wake();
    },
    true,
  );
for (const name of ["seeked", "loadedmetadata", "ratechange", "durationchange"])
  document.addEventListener(name, wake, true);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !frame) tick();
});
tick();
window.addEventListener(
  "pagehide",
  () => {
    cancelAnimationFrame(frame);
    frame = 0;
    observer.disconnect();
    ranges = [];
    active.clear();
  },
  { once: true },
);
