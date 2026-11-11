import { mountPictureDisc, setPictureDiscArtwork } from "./music-picture-disc.js";
import { keepPresses } from "./press-capture.js";
import { t, onLanguageChange } from "./i18n.js";
import { paintAmbient, ambientArtwork } from "./music-ambient-light.js";
import { registerPlaybackRange, isRangeDragging, wakePlaybackRanges } from "./player-controls.js";
import { wireMiniQueue } from "./music-mini-queue.js";
import { createMusicClip } from "./music-clip.js";
import { wireGlassOrb, wireGlassButtons } from "./music-glass.js";
// A press near the edge of a shrinking player button still counts (see press-capture.js).
keepPresses();
const $ = id => document.getElementById(id),
  invoke = window.__TAURI__.core.invoke;
const time = n =>
  `${Math.floor((Number(n) || 0) / 60)}:${String(Math.floor((Number(n) || 0) % 60)).padStart(2, "0")}`;
const glyphs = {
  play: "play",
  pause: "pause",
  previous: "skip-back",
  next: "skip-forward",
  repeat: "repeat",
  shuffle: "shuffle",
  volume: "speaker-high",
  muted: "speaker-high",
};
function icon(id, name, one = false) {
  const button = $(id);
  if (button.dataset.icon === name + one) return;
  button.dataset.icon = name + one;
  const glyph = document.createElement("span");
  glyph.className = "mini-glyph";
  glyph.setAttribute("aria-hidden", "true");
  glyph.style.setProperty("--mini-glyph", `url('./assets/icons/${glyphs[name]}.svg')`);
  button.replaceChildren(glyph);
  if (id === "mini-repeat") button.dataset.repeat = one ? "one" : "all";
  if (id === "mini-mute") button.dataset.muted = String(name === "muted");
}
const record = mountPictureDisc(document.querySelector(".mini-art"));
let state = {},
  pinned = false,
  receivedAt = 0,
  videoOn = false,
  lyricsOn = false;
try {
  lyricsOn = localStorage.getItem("deviload-mini-lyrics") === "1";
} catch {}
const queueView = wireMiniQueue({ invoke });
registerPlaybackRange($("mini-progress"), () =>
  state.duration
    ? Math.min(
        state.duration,
        state.position +
          (state.playing ? Math.min(1.1, (performance.now() - receivedAt) / 1000) * (state.rate || 1) : 0),
      ) / state.duration
    : 0,
  () => !!state.playing,
);
$("mini-progress").step = "any";
// The timeline is the same glass tube as in the main player: the liquid moves while the song plays.
const tube = document.createElement("div"),
  progress = $("mini-progress");
tube.className = "music-liquid";
progress.replaceWith(tube);
tube.append(progress);
// The play button is the same glass orb; its glow and the timeline breathe with the bass.
$("mini-play").classList.add("music-play-button");
const orb = wireGlassOrb($("mini-play"), { host: document.body });
wireGlassButtons();
const glow = document.createElement("div");
glow.className = "mini-ambient-glow";
glow.setAttribute("aria-hidden", "true");
const lights = Array.from({ length: 3 }, () => {
  const node = document.createElement("span");
  glow.append(node);
  return node;
});
document.body.prepend(glow);
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
let lightTimeout = 0;
const resetLight = () => {
  clearTimeout(lightTimeout);
  paintAmbient(lights, [0, 0, 0]);
};
reduced.addEventListener("change", resetLight);
function render(value) {
  state = value || {};
  receivedAt = performance.now();
  // A new state may start the song: the timeline wakes to follow it.
  wakePlaybackRanges();
  document.documentElement.dataset.theme = ["ambient", "glass-light", "aurora", "prism"].includes(state.theme)
    ? state.theme
    : "ambient";
  const variants = ["noir", "vinyl", "paper"];
  if (variants.includes(state.variant)) document.documentElement.dataset.variant = state.variant;
  else delete document.documentElement.dataset.variant;
  $("mini-title").textContent = state.title || t("Pick your first track");
  $("mini-artist").textContent = state.artist || "";
  document.documentElement.style.setProperty("--ambient-art", ambientArtwork(state.image));
  if (!state.playing || !["ambient", "aurora", "prism"].includes(state.theme) || reduced.matches)
    resetLight();
  document.querySelector(".mini-art").classList.toggle("is-playing", !!state.playing);
  tube.classList.toggle("is-playing", !!state.playing);
  setPictureDiscArtwork(record, state.image, 144);
  icon("mini-play", state.playing ? "pause" : "play");
  icon("mini-previous", "previous");
  icon("mini-next", "next");
  icon("mini-repeat", "repeat", state.repeat === "one");
  icon("mini-shuffle", "shuffle");
  icon("mini-mute", state.volume > 0 ? "volume" : "muted");
  $("mini-play").disabled = !state.active;
  $("mini-previous").disabled = !state.previousEnabled;
  $("mini-next").disabled = !state.nextEnabled;
  $("mini-repeat").setAttribute("aria-pressed", String(state.repeat !== "off"));
  $("mini-shuffle").setAttribute("aria-pressed", String(!!state.shuffle));
  $("mini-mute").setAttribute("aria-pressed", String(!state.volume));
  $("mini-position").textContent = time(state.position);
  $("mini-duration").textContent = time(state.duration);
  $("mini-progress").disabled = !state.duration;
  if (!isRangeDragging($("mini-volume"))) $("mini-volume").value = state.volume || 0;
  labels();
  queueView.update(state);
}
function labels() {
  for (const [id, label] of [
    ["mini-lyrics", lyricsOn ? t("Hide lyrics") : t("Show lyrics")],
    ["mini-video", videoOn ? t("Close music video") : t("Music video")],
    ["mini-pin", t("Always on top")],
    ["mini-show", t("Open Devil Music")],
    ["mini-close", t("Close")],
    ["mini-play", state.playing ? t("Pause") : t("Play")],
    ["mini-previous", t("Previous track")],
    ["mini-next", t("Next track")],
    [
      "mini-repeat",
      state.repeat === "one"
        ? t("Repeat one song")
        : state.repeat === "all"
          ? t("Repeat queue")
          : t("Repeat off"),
    ],
    ["mini-shuffle", t("Shuffle")],
    ["mini-mute", state.volume > 0 ? t("Mute") : t("Unmute")],
    ["mini-volume", t("Volume")],
    ["mini-progress", t("Playback position")],
  ])
    $(id).title = $(id).ariaLabel = label;
  $("mini-pin").setAttribute("aria-pressed", String(pinned));
  $("mini-volume").setAttribute("aria-valuetext", Math.round(Number($("mini-volume").value) * 100) + "%");
}
async function action(action, value) {
  try {
    const result = await invoke("music_mini_action", { action, value });
    if (action === "pin") pinned = result;
    labels();
    $("mini-status").textContent = "";
  } catch {
    $("mini-status").textContent = t("Could not control playback.");
  }
}
for (const name of ["pin", "show", "previous", "play", "next", "repeat", "shuffle", "mute", "close"])
  $("mini-" + name).addEventListener("click", () => action(name));
$("mini-volume").addEventListener("input", () => {
  labels();
  action("volume", Number($("mini-volume").value));
});
$("mini-volume").addEventListener(
  "wheel",
  event => {
    event.preventDefault();
    $("mini-volume").value = String(
      Math.max(0, Math.min(1, Number($("mini-volume").value) + (event.deltaY < 0 ? 0.03 : -0.03))),
    );
    $("mini-volume").dispatchEvent(new Event("input"));
  },
  { passive: false },
);
$("mini-progress").addEventListener("input", () => action("seek", Number($("mini-progress").value)));
$("mini-drag").addEventListener("mousedown", event => {
  if (event.button === 0 && !event.target.closest("button")) action("drag");
});
await window.__TAURI__.event.listen("music-mini-ambient", ({ payload }) => {
  if (
    !["ambient", "aurora", "prism"].includes(state.theme) ||
    !state.playing ||
    reduced.matches ||
    payload?.image !== (state.image || "")
  )
    return;
  paintAmbient(lights, payload.levels);
  orb.energy(payload.levels?.[0]);
  clearTimeout(lightTimeout);
  lightTimeout = setTimeout(() => {
    resetLight();
    orb.energy(0);
  }, 350);
});
await window.__TAURI__.event.listen("music-mini-state", ({ payload }) => render(payload));
render(await invoke("music_mini_state"));
onLanguageChange(() => render(state));

// Video mode: the window grows into a freely resizable picture of the song's music video, and the controls rest
// out of sight until the pointer comes back. The song keeps playing in the main window; the picture follows it.
let videoSong = "";
const stage = $("mini-stage");
const clock = {
  get currentTime() {
    return state.duration
      ? Math.min(
          state.duration,
          (state.position || 0) +
            (state.playing ? Math.min(1.1, (performance.now() - receivedAt) / 1000) * (state.rate || 1) : 0),
        )
      : 0;
  },
  get paused() {
    return !state.playing;
  },
  get playbackRate() {
    return state.rate || 1;
  },
};
const song = () =>
  state.id
    ? { id: state.id, title: state.title, artists: state.artists || [], duration: state.duration }
    : null;
const clip = createMusicClip({
  invoke,
  language: () => document.documentElement.lang || "en",
  getItem: song,
  getHost: () => stage,
  isVisible: () => videoOn && !document.hidden,
  getAudio: () => clock,
  onState: value => {
    document.body.classList.toggle("video-missing", !!value.enabled && !!(value.missing || value.failed));
  },
  onBuffering: on => document.body.classList.toggle("video-buffering", on),
});
async function setVideo(on) {
  if (on === videoOn) return;
  try {
    await invoke("music_mini_action", { action: "video", value: on ? 1 : 0 });
  } catch {
    return;
  }
  videoOn = on;
  videoSong = "";
  document.body.classList.toggle("is-video", on);
  if (on !== clip.enabled) clip.toggle();
  labels();
}
$("mini-video").addEventListener("click", () => setVideo(!videoOn));

// Lyrics: the current line replaces the artist under the title, filling in as it is sung.
let lyric = null,
  lyricAt = 0,
  lyricKey = "",
  lyricFrame = 0;
function showLyrics(on) {
  lyricsOn = on;
  try {
    localStorage.setItem("deviload-mini-lyrics", on ? "1" : "0");
  } catch {}
  document.body.classList.toggle("has-lyric", on);
  $("mini-lyrics").setAttribute("aria-pressed", String(on));
  $("mini-lyric").hidden = !on;
  $("mini-artist").hidden = on;
  paintLyric(true);
  labels();
}
function paintLyric(force = false) {
  lyricFrame = 0;
  if (!lyricsOn) return;
  const node = $("mini-lyric"),
    line = lyric?.line || {};
  const key = `${lyric?.id}|${line.at}|${line.text}`;
  if (force || key !== lyricKey) {
    lyricKey = key;
    node.textContent = line.text || "♪";
    node.classList.remove("is-new");
    void node.offsetWidth;
    node.classList.add("is-new");
  }
  const time = !lyric
    ? 0
    : lyric.position + (lyric.playing ? ((performance.now() - lyricAt) / 1000) * (lyric.rate || 1) : 0);
  const span = Math.max(0.5, (line.end || line.at + 4) - line.at);
  node.style.setProperty(
    "--fill",
    `${Math.min(100, Math.max(0, ((time - line.at) / span) * 100)).toFixed(1)}%`,
  );
  if (lyric?.playing) lyricFrame = requestAnimationFrame(() => paintLyric());
}
window.__TAURI__.event.listen("lyrics-line", ({ payload }) => {
  lyric = payload;
  lyricAt = performance.now();
  if (lyricFrame) cancelAnimationFrame(lyricFrame);
  paintLyric();
});
$("mini-lyrics").addEventListener("click", () => showLyrics(!lyricsOn));
showLyrics(lyricsOn);
setInterval(() => {
  if (!videoOn) return;
  const item = song();
  if ((item?.id || "") !== videoSong) {
    videoSong = item?.id || "";
    clip.update(item);
  }
  clip.align();
}, 120);
