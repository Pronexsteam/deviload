import { safeArtworkUrl } from "./music-artwork.js";
import { playlistCover } from "./music-library-model.js";

export function playlistArtwork(list, cover, size = 320) {
  const art = document.createElement("span");
  art.className = "music-playlist-art";
  if (playlistCover(list.cover)) {
    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.src = list.cover;
    art.append(image);
    return art;
  }
  const seen = new Set();
  for (const track of list.items || []) {
    const url = safeArtworkUrl(track.image);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    art.append(cover(track, "", size));
    if (seen.size === 4) break;
  }
  if (!seen.size) {
    const label = document.createElement("span");
    label.className = "music-typographic-cover";
    label.textContent = [...String(list.name || "")][0]?.toLocaleUpperCase() || "";
    art.append(label);
  }
  return art;
}
