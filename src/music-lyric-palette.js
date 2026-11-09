import { artworkCandidates } from "./music-artwork.js";

// Tiny thumbnail samples select a hue; text lightness stays controlled so a
// dark/red cover cannot turn the currently sung word into unreadable text.
export function lyricPalette(pixels) {
  const bins = Array.from({ length: 24 }, () => ({ weight: 0, sin: 0, cos: 0 }));
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const r = pixels[i] / 255,
      g = pixels[i + 1] / 255,
      b = pixels[i + 2] / 255,
      max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      delta = max - min;
    if (pixels[i + 3] < 180 || max < 0.13 || min > 0.9 || delta < 0.09) continue;
    const saturation = delta / max;
    let hue = (max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60;
    hue = (hue + 360) % 360;
    const bin = bins[Math.floor(hue / 15)],
      weight = saturation * (0.4 + Math.min(max, 1 - max + 0.3));
    bin.weight += weight;
    bin.sin += Math.sin((hue * Math.PI) / 180) * weight;
    bin.cos += Math.cos((hue * Math.PI) / 180) * weight;
  }
  const winner = bins.reduce((a, b) => (a.weight >= b.weight ? a : b));
  if (!winner.weight) return { light: "#d2d9ea", dark: "#35435e" };
  const hue = Math.round(((Math.atan2(winner.sin, winner.cos) * 180) / Math.PI + 360) % 360);
  return { light: `hsl(${hue} 78% 80%)`, dark: `hsl(${hue} 60% 29%)` };
}

export function createLyricPalette(root = document.documentElement) {
  const cache = new Map();
  let source = "",
    generation = 0,
    image = null,
    timer = 0;
  const apply = palette => {
    root.style.setProperty("--cover-lyric-light", palette.light);
    root.style.setProperty("--cover-lyric-dark", palette.dark);
  };
  function update(raw) {
    const next = artworkCandidates(raw, 96)[0] || "";
    if (next === source) return;
    source = next;
    const token = ++generation;
    clearTimeout(timer);
    if (image) {
      image.onload = image.onerror = null;
      image.src = "";
      image = null;
    }
    apply(cache.get(next) || lyricPalette([]));
    if (!next || cache.has(next)) return;
    const node = new Image();
    image = node;
    node.crossOrigin = "anonymous";
    node.decoding = "async";
    node.referrerPolicy = "no-referrer";
    const finish = palette => {
      if (token !== generation) return;
      clearTimeout(timer);
      node.onload = node.onerror = null;
      image = null;
      if (cache.size >= 24) cache.delete(cache.keys().next().value);
      cache.set(next, palette);
      apply(palette);
    };
    node.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 32;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(node, 0, 0, 32, 32);
        finish(lyricPalette(ctx.getImageData(0, 0, 32, 32).data));
      } catch {
        finish(lyricPalette([]));
      }
    };
    node.onerror = () => finish(lyricPalette([]));
    timer = setTimeout(() => {
      node.src = "";
      finish(lyricPalette([]));
    }, 5000);
    node.src = next;
  }
  return { update };
}
