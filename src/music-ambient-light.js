import { artworkCandidates } from "./music-artwork.js";
// The main window and mini-player render the same bounded audio envelope.
export function paintAmbient(lights, levels) {
  lights.forEach((light, i) => {
    const value = Number(levels?.[i]),
      level = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    light.style.opacity = String(0.17 + level * 0.76);
    light.style.transform = `translateY(${-level * 6}%) scale(${1 + level * 0.28})`;
  });
}
export function ambientArtwork(source) {
  const url = artworkCandidates(source, 640)[0];
  if (url) return `url(${JSON.stringify(url)})`;
  return "none";
}
