import { t, onLanguageChange } from "./i18n.js";
import { canonicalArtistKey } from "./music-taste.js";
import { aiArtistFilter } from "./music-ai-filter.js";

// The "Hide AI-made artists" switch in Music settings. The list comes from the community project
// github.com/CennoxX/spotify-ai-blocker, is downloaded only while the switch is on, kept on this device and
// refreshed once a week. It only shapes recommendations and radio: search and the library show everything.
const SWITCH = "deviload-music-hide-ai",
  CACHE = "deviload-music-ai-artists-v1",
  WEEK = 7 * 24 * 60 * 60 * 1000;

export function wireAiArtists({ invoke, storage = globalThis.localStorage, now = () => Date.now() } = {}) {
  const box = document.getElementById("music-hide-ai"),
    note = document.getElementById("music-hide-ai-note");
  if (!box) return;
  const read = key => {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
    } catch {
      /* Without storage the filter lasts for this session. */
    }
  };
  let cached = null;
  try {
    const value = JSON.parse(read(CACHE) || "null");
    if (value && Array.isArray(value.names)) cached = { at: Number(value.at) || 0, names: value.names };
  } catch {
    cached = null;
  }
  const apply = () => {
    aiArtistFilter.set(
      box.checked && cached ? new Set(cached.names.map(canonicalArtistKey).filter(Boolean)) : null,
    );
    describe();
  };
  let failed = false;
  function describe() {
    note.textContent = failed
      ? t("The AI artist list could not be downloaded. Devil Music tries again later.")
      : box.checked && aiArtistFilter.size
        ? t("{count} artists from a community list are kept out of recommendations and radio.", {
            count: aiArtistFilter.size.toLocaleString(),
          })
        : t(
            "Keeps artists that publish AI-generated music out of recommendations and radio, using a community list.",
          );
  }
  async function refresh(force = false) {
    if (!box.checked || !invoke) return;
    if (!force && cached && now() - cached.at < WEEK) return;
    try {
      const names = await invoke("music_ai_artists");
      cached = { at: now(), names };
      failed = false;
      write(CACHE, JSON.stringify(cached));
    } catch {
      failed = true;
    }
    apply();
  }
  box.checked = read(SWITCH) === "on";
  box.addEventListener("change", () => {
    write(SWITCH, box.checked ? "on" : "off");
    failed = false;
    apply();
    refresh(!cached);
  });
  onLanguageChange(describe);
  apply();
  refresh();
}
