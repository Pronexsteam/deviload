import { t, onLanguageChange } from "./i18n.js";
import { lineAt } from "./music-timeline-model.js";

// The song's timeline: a glass tube that fills as the song plays, with bubbles drifting through the
// liquid while it plays. Under the pointer it shows the time and the line sung there; a click on the
// length switches it to the time left.
const REMAINING_KEY = "deviload-music-time-left";

export function wireTimeline({
  seek,
  elapsed,
  duration,
  getAudio,
  lyrics,
  time,
  storage = globalThis.localStorage,
}) {
  const make = (tag, cls) => {
    const node = document.createElement(tag);
    node.className = cls;
    return node;
  };
  const wrap = make("div", "music-seek music-liquid"),
    ghost = make("div", "music-seek-ghost"),
    bubble = make("div", "music-seek-bubble");
  const bubbleTime = make("strong", ""),
    bubbleLine = make("span", "");
  bubble.append(bubbleTime, bubbleLine);
  bubble.setAttribute("aria-hidden", "true");
  ghost.setAttribute("aria-hidden", "true");
  seek.replaceWith(wrap);
  wrap.append(ghost, seek, bubble);

  let splash = 0,
    timed = { id: "", lines: [] },
    remaining = false,
    hovering = false,
    dragging = false,
    pointerX = 0,
    prefetch = 0;
  try {
    remaining = storage?.getItem(REMAINING_KEY) === "1";
  } catch {
    /* Shown as the length. */
  }
  const songLength = () => {
    const audio = getAudio();
    return Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
  };

  const readLines = () => {
    timed = lyrics.timeline();
  };
  // The thumb travels between half-thumb insets, so positions use the same inner box.
  function fractionAt(x) {
    const box = seek.getBoundingClientRect(),
      inset = 6;
    return Math.max(0, Math.min(1, (x - box.left - inset) / Math.max(1, box.width - inset * 2)));
  }
  function showBubble() {
    const length = songLength();
    if (!length || seek.disabled) {
      wrap.classList.remove("is-peeking");
      return;
    }
    const fraction = dragging ? Number(seek.value) / 1000 : fractionAt(pointerX),
      at = fraction * length;
    bubbleTime.textContent = time(at);
    const words = timed.lines.length ? lineAt(timed.lines, at) : "";
    bubbleLine.textContent = words;
    bubble.classList.toggle("has-line", !!words);
    const box = wrap.getBoundingClientRect(),
      half = bubble.offsetWidth / 2,
      x = 6 + fraction * (box.width - 12);
    bubble.style.left = `${Math.max(half, Math.min(box.width - half, x))}px`;
    wrap.classList.add("is-peeking");
    // A faint pour from the play position to the pointer shows where a click would take the song.
    const now = 6 + (Number(seek.value) / 1000) * (box.width - 12);
    ghost.style.left = `${Math.min(now, x)}px`;
    ghost.style.width = `${Math.abs(x - now)}px`;
    ghost.classList.toggle("is-back", x < now);
  }
  wrap.addEventListener("pointerenter", () => {
    hovering = true;
    readLines();
  });
  wrap.addEventListener("pointermove", event => {
    pointerX = event.clientX;
    showBubble();
  });
  wrap.addEventListener("pointerleave", () => {
    hovering = false;
    if (!dragging) wrap.classList.remove("is-peeking");
  });
  seek.addEventListener("pointerdown", () => {
    dragging = true;
    wrap.classList.add("is-dragging");
  });
  for (const name of ["pointerup", "pointercancel"])
    window.addEventListener(name, () => {
      if (!dragging) return;
      dragging = false;
      wrap.classList.remove("is-dragging");
      if (!hovering) wrap.classList.remove("is-peeking");
    });
  seek.addEventListener("input", () => {
    if (dragging) showBubble();
  });

  const audios = new Set();
  function syncPlaying() {
    const audio = getAudio(),
      playing = !audio.paused && !audio.ended;
    if (wrap.classList.contains("is-playing") !== playing) wrap.classList.toggle("is-playing", playing);
  }
  function watchAudio() {
    syncPlaying();
    const audio = getAudio();
    if (audios.has(audio)) return;
    audios.add(audio);
    // A jump makes the liquid's front splash.
    audio.addEventListener("seeked", () => {
      if (audio !== getAudio()) return;
      wrap.classList.remove("is-splash");
      void wrap.offsetWidth;
      wrap.classList.add("is-splash");
      clearTimeout(splash);
      splash = setTimeout(() => wrap.classList.remove("is-splash"), 700);
    });
    // The liquid moves while the song plays and goes still when it stops. Any player's event checks the
    // one now in use: the next song may start on another player before it is watched here.
    for (const name of ["play", "playing", "pause", "ended", "emptied"])
      audio.addEventListener(name, syncPlaying);
    // The lyrics are fetched a moment into the song, so a quick skip costs nothing.
    audio.addEventListener("playing", () => {
      if (audio !== getAudio()) return;
      readLines();
      clearTimeout(prefetch);
      prefetch = setTimeout(() => {
        if (audio === getAudio() && !audio.paused && !document.hidden) lyrics.prefetch();
      }, 1500);
    });
  }
  watchAudio();
  setInterval(watchAudio, 2000);
  lyrics.onLoad(readLines);

  // The length, or the time left.
  duration.classList.add("music-time-toggle");
  duration.setAttribute("role", "button");
  duration.tabIndex = 0;
  const label = () => {
    duration.title = duration.ariaLabel = remaining ? t("Show song length") : t("Show time left");
  };
  function toggle() {
    remaining = !remaining;
    try {
      storage?.setItem(REMAINING_KEY, remaining ? "1" : "0");
    } catch {
      /* For this session. */
    }
    label();
    paintTime();
  }
  duration.addEventListener("click", toggle);
  duration.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  });
  function paintTime() {
    const audio = getAudio(),
      length = songLength();
    if (!length) return;
    const text = remaining ? `-${time(Math.max(0, length - audio.currentTime))}` : time(length);
    if (duration.textContent !== text) duration.textContent = text;
  }
  // The player repaints the length with every tick; this puts the time left back when that is shown.
  duration.paintTime = paintTime;
  label();
  onLanguageChange(label);
  return { paintTime, readLines };
}
