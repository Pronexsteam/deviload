import {t, onLanguageChange} from "./i18n.js";
import {wireGlassMaterial} from "./theme-glass.js";

export const THEME_KEY = "deviload-theme";
export const THEMES = Object.freeze(["classic", "glass-light", "matte-black", "glass-black"]);
const wired = new WeakMap();
export function normalizeTheme(value) { return THEMES.includes(value) ? value : "classic"; }

function browserStorage(window) {
  try { return window.localStorage; } catch { return null; }
}
export function readTheme(storage) {
  try { return normalizeTheme(storage?.getItem(THEME_KEY)); } catch { return "classic"; }
}

// Only appearance changes: switching never reloads a window or touches playback.
export function applyTheme(value, {document = globalThis.document, window = globalThis.window,
  storage = browserStorage(window), persist = false} = {}) {
  const theme = normalizeTheme(value), root = document.documentElement;
  let saved = !persist;
  if (persist) {
    try { if (storage) { storage.setItem(THEME_KEY, theme); saved = true; } } catch { /* session only */ }
  }
  root.dataset.theme = theme;
  root.dataset.motion = theme === "classic" ? "full" : "reduced";
  root.style.colorScheme = theme === "glass-light" ? "light" : "dark";
  const select = document.getElementById("appearance-theme");
  if (select) select.value = theme;
  document.dispatchEvent(new window.CustomEvent("deviload-theme-change", {detail:{theme}}));
  document.dispatchEvent(new window.Event("deviload-motion-change"));
  return {theme, saved};
}

export function wireAppearance({document = globalThis.document, window = globalThis.window,
  storage = browserStorage(window), glass = wireGlassMaterial, languageChange = onLanguageChange} = {}) {
  if (wired.has(document)) return wired.get(document);
  const select = document.getElementById("appearance-theme");
  const status = document.getElementById("appearance-status");
  let sessionOnly = false;
  const updateStatus = () => {
    if (status) status.textContent = sessionOnly
      ? t("Theme applied for this session. Storage is unavailable.")
      : t("Your theme is saved on this device.");
  };
  const apply = (value, persist = false) => applyTheme(value, {document, window, storage, persist});
  apply(readTheme(storage));
  const stopGlass = glass({document, window});
  const change = () => { sessionOnly = !apply(select.value, true).saved; updateStatus(); };
  const storageChange = event => {
    if (event.storageArea && event.storageArea !== storage) return;
    if (event.key !== THEME_KEY && event.key !== null) return;
    apply(readTheme(storage)); sessionOnly = false; updateStatus();
  };
  select?.addEventListener("change", change);
  window.addEventListener("storage", storageChange);
  const stopLanguage = languageChange(updateStatus);
  updateStatus();
  let stopped = false;
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    select?.removeEventListener("change", change);
    window.removeEventListener("storage", storageChange);
    window.removeEventListener("pagehide", pagehide);
    stopLanguage?.(); stopGlass?.(); wired.delete(document);
  };
  // bfcache keeps listeners alive so a restored page still follows the theme.
  const pagehide = event => { if (!event.persisted) cleanup(); };
  window.addEventListener("pagehide", pagehide);
  wired.set(document, cleanup);
  return cleanup;
}
