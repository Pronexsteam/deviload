import { isLocalMusicId } from "./music-track-id.js";
import { markDecorative } from "./music-motion.js";
import { loadArtwork } from "./music-artwork.js";

// Canvas: a silent looping picture behind the full player, and behind the whole Devil Music page in the Live theme.
// A real canvas clip comes first (the moving covers collection); otherwise a few seconds of the song's official
// video repeat in place. Local files stay local, so they get none.
const KEY = "deviload-music-canvas";
const LOOK_KEY = "deviload-music-canvas-look";
export const CANVAS_LOOP = 9;
export const CANVAS_QUALITIES = Object.freeze(["auto", 720, 1080, 1440]);
const DEFAULT_LOOK = Object.freeze({ dim: 0.3, quality: "auto" });

// Where a music video's loop starts: past the intro, about a third of the way in, with room for the whole loop.
export function canvasLoopStart(duration) {
  if (!Number.isFinite(duration) || duration <= CANVAS_LOOP + 2) return 0;
  return Math.max(0, Math.min(duration - CANVAS_LOOP - 1, Math.max(5, duration * 0.33)));
}

// The video fills the window, so on "auto" its quality follows the window: 720p in an ordinary one, 1080p when it
// is tall (or the screen is dense) enough to show the difference.
export function canvasQuality(height, ratio = 1, choice = "auto") {
  if (CANVAS_QUALITIES.includes(choice) && choice !== "auto") return choice;
  const pixels = (Number(height) || 0) * (Number(ratio) || 1);
  return pixels > 900 ? 1080 : 720;
}

// How dark the video sits (0 shows it as it is, 0.8 nearly hides it) and how sharp it is.
export function normalizeCanvasLook(value) {
  const dim = Number(value?.dim);
  const quality = CANVAS_QUALITIES.includes(value?.quality) ? value.quality : DEFAULT_LOOK.quality;
  return {
    dim: Number.isFinite(dim) ? Math.round(Math.max(0, Math.min(0.8, dim)) * 100) / 100 : DEFAULT_LOOK.dim,
    quality,
  };
}
export function readCanvasLook(storage = globalThis.localStorage) {
  try {
    return normalizeCanvasLook(JSON.parse(storage?.getItem(LOOK_KEY) || "null"));
  } catch {
    return { ...DEFAULT_LOOK };
  }
}
export function applyCanvasLook(look, root = globalThis.document?.documentElement) {
  root?.style.setProperty("--canvas-dim", String(normalizeCanvasLook(look).dim));
}
export function saveCanvasLook(look, storage = globalThis.localStorage) {
  const value = normalizeCanvasLook(look);
  try {
    storage?.setItem(LOOK_KEY, JSON.stringify(value));
  } catch {}
  applyCanvasLook(value);
  globalThis.dispatchEvent?.(new CustomEvent("music-canvas-look", { detail: value }));
  return value;
}

// One lookup per song, shared by the full player and the Live page, and started as soon as the song does, so the
// picture is ready by the time anyone opens the player. A stream address stays valid until another video stream is
// asked for, so only the current song keeps one.
export function createCanvasSources({ invoke, convertFileSrc, findClip, storage = globalThis.localStorage }) {
  const sources = new Map(),
    streams = new Set(),
    prepared = new Set();
  // The song playing is looked up first; the next one waits for it.
  let latest = Promise.resolve();
  const songKey = item => JSON.stringify([item.id, item.title, item.artists]);
  async function resolve(item, height) {
    const album = typeof item.album === "string" ? item.album : item.album?.title || item.album?.name || "";
    const path = await invoke("music_motion", {
      title: item.title,
      artist: item.artists?.join(", ") || "",
      album,
    }).catch(() => null);
    if (path) return { canvas: true, url: convertFileSrc(path) };
    const id = await Promise.resolve(findClip(item)).catch(() => null);
    if (!id) return null;
    // The direct stream comes first: it seeks straight to a stretch a third of the way in. The music engine's
    // stream only plays on from the start, so it is the fallback and its loop stays near the start.
    const direct = await invoke("cinema_stream", { id, quality: height, silent: true }).catch(() => null);
    if (direct?.url) return { canvas: false, url: direct.url };
    const engine = await invoke("music_clip_stream", { id, height }).catch(() => null);
    return engine?.url ? { canvas: false, url: engine.url, early: true } : null;
  }
  function key(item) {
    const look = readCanvasLook(storage);
    return (
      songKey(item) + "@" + canvasQuality(globalThis.innerHeight, globalThis.devicePixelRatio, look.quality)
    );
  }
  return {
    key,
    // A promise of the song's source; null once it is known to have none.
    get(item) {
      const at = key(item);
      if (sources.has(at)) return sources.get(at);
      // Asking for a new stream ends the previous one, so its address is forgotten.
      for (const old of streams) sources.delete(old);
      streams.clear();
      if (sources.size >= 40) sources.delete(sources.keys().next().value);
      const height = Number(at.slice(at.lastIndexOf("@") + 1));
      const pending = resolve(item, height).then(source => {
        if (sources.get(at) !== pending) return source;
        if (!source) sources.set(at, Promise.resolve(null));
        else if (!source.canvas) streams.add(at);
        return source;
      });
      sources.set(at, pending);
      latest = pending.catch(() => {});
      return pending;
    },
    forget(at) {
      sources.delete(at);
      streams.delete(at);
    },
    prefetch(item) {
      if (item?.id && !isLocalMusicId(item.id)) this.get(item).catch(() => {});
    },
    // The song after this one: its video is found and its stream looked up in advance, without starting it,
    // so its Canvas appears about a second after it begins instead of several.
    prepare(item) {
      if (!item?.id || isLocalMusicId(item.id) || prepared.has(songKey(item))) return;
      prepared.add(songKey(item));
      if (prepared.size > 40) prepared.delete(prepared.values().next().value);
      const height = Number(key(item).slice(key(item).lastIndexOf("@") + 1));
      latest
        .then(() => findClip(item))
        .then(id => id && invoke("cinema_prepare", { id, quality: height, silent: true }))
        .catch(() => {});
    },
  };
}

export function createMusicCanvas({
  host,
  sources,
  isVisible,
  isPlaying,
  // Only the full player's Canvas has an on/off switch; the Live theme is switched on by choosing it.
  storage = globalThis.localStorage,
}) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let enabled = true;
  try {
    enabled = storage?.getItem(KEY) !== "off";
  } catch {}
  let track = null,
    key = "",
    serial = 0,
    looking = "",
    // The song's cover shows at once; its video, once it plays, fades in over it.
    cover = null,
    video = null;
  const retries = new Map();
  function clear() {
    host.classList.remove("is-ready");
    for (const node of [video, cover]) if (node) release(node);
    video = cover = null;
  }
  function allowed(item) {
    return (
      !!item && enabled && !reduced.matches && !document.hidden && isVisible() && !isLocalMusicId(item.id)
    );
  }
  function build(source) {
    const node = markDecorative(document.createElement("video"));
    node.className = "music-canvas-video";
    node.muted = true;
    node.playsInline = true;
    node.preload = "auto";
    node.setAttribute("aria-hidden", "true");
    node.loop = source.canvas;
    if (!source.canvas) {
      let start = 0;
      node.addEventListener(
        "loadedmetadata",
        () => {
          start = source.early ? Math.min(8, canvasLoopStart(node.duration)) : canvasLoopStart(node.duration);
          node.currentTime = start;
        },
        { once: true },
      );
      node.addEventListener("timeupdate", () => {
        if (node.currentTime >= start + CANVAS_LOOP || node.currentTime < start - 1) node.currentTime = start;
      });
      node.addEventListener("ended", () => {
        node.currentTime = start;
        if (isPlaying()) node.play().catch(() => {});
      });
    }
    node.src = source.url;
    return node;
  }
  function release(node) {
    if (node instanceof HTMLVideoElement) {
      node.pause();
      node.removeAttribute("src");
      node.load();
    }
    node.remove();
  }
  // The cover, large and drifting slowly: right away while the video is looked up, and for good when the song has
  // no video of its own, so the space is never empty.
  function showCover(item) {
    const img = document.createElement("img");
    img.className = "music-canvas-video music-canvas-cover";
    img.setAttribute("aria-hidden", "true");
    if (!loadArtwork(img, item.image, 1200)) return;
    img.loading = "eager";
    img.addEventListener("load", () => {
      if (cover === img) host.classList.add("is-ready");
    });
    cover = img;
    host.prepend(img);
  }
  function mount(source, at) {
    const node = build(source);
    node.classList.add("is-incoming");
    node.addEventListener("playing", () => {
      if (video !== node) return;
      node.classList.add("is-shown");
      host.classList.add("is-ready");
      const under = cover;
      setTimeout(() => {
        if (under && cover === under && video === node) {
          release(under);
          cover = null;
        }
      }, 900);
    });
    node.addEventListener("error", () => {
      if (video !== node) return;
      // A broken stream is asked for again, twice at most for the same song and quality; the cover stays meanwhile.
      sources.forget(at);
      release(node);
      video = null;
      const tries = (retries.get(at) || 0) + 1;
      retries.set(at, tries);
      if (tries <= 2) setTimeout(() => update(track), 1500 * tries);
    });
    video = node;
    host.append(node);
    sync();
  }
  function sync() {
    if (!video && !cover) return;
    if (!allowed(track)) {
      clear();
      return;
    }
    if (!video) return;
    if (isPlaying()) {
      if (video.paused) video.play().catch(() => {});
    } else video.pause();
  }
  async function update(item) {
    track = item;
    const next = item ? sources.key(item) : "";
    if (next !== key) {
      key = next;
      serial++;
      looking = "";
      clear();
    }
    if (!allowed(item)) {
      clear();
      return;
    }
    if (video) {
      sync();
      return;
    }
    if (!cover && item.image) showCover(item);
    if (looking === key) return;
    const at = key,
      token = serial;
    looking = at;
    const source = await sources.get(item).catch(() => null);
    if (looking === at) looking = "";
    if (!source || token !== serial || key !== at || video || !allowed(track)) return;
    mount(source, at);
  }
  const refresh = () => update(track);
  document.addEventListener("visibilitychange", refresh);
  reduced.addEventListener("change", refresh);
  // A new quality is a new stream.
  globalThis.addEventListener?.("music-canvas-look", refresh);
  return {
    update,
    sync,
    get enabled() {
      return enabled;
    },
    setEnabled(value) {
      enabled = !!value;
      try {
        storage?.setItem(KEY, enabled ? "on" : "off");
      } catch {}
      update(track);
    },
  };
}
