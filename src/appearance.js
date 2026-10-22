import {t, onLanguageChange} from "./i18n.js";
import {wireGlassMaterial} from "./theme-glass.js";

export const THEME_KEY = "deviload-theme";
export const THEMES = Object.freeze(["classic", "glass-light", "matte-black", "glass-black", "midnight", "spotify"]);
const themeLabels = {classic:"Classic", "glass-light":"Light Liquid Glass", "matte-black":"Matte black", "glass-black":"Black Liquid Glass", midnight:"Midnight", spotify:"Studio green"};
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
  for (const item of document.querySelectorAll?.("[data-theme-choice]") || []) {
    const selected = item.dataset.themeChoice === theme;
    item.setAttribute("aria-checked", String(selected));item.tabIndex = selected ? 0 : -1;
  }
  document.dispatchEvent(new window.CustomEvent("deviload-theme-change", {detail:{theme}}));
  document.dispatchEvent(new window.Event("deviload-motion-change"));
  return {theme, saved};
}

export function wireAppearance({document = globalThis.document, window = globalThis.window,
  storage = browserStorage(window), glass = wireGlassMaterial, languageChange = onLanguageChange} = {}) {
  if (wired.has(document)) return wired.get(document);
  const select = document.getElementById("appearance-theme");
  const status = document.getElementById("appearance-status");
  const quickButton = document.getElementById("quick-theme-button");
  const quickMenu = document.getElementById("quick-theme-menu");
  const quickLabel = document.getElementById("quick-theme-label");
  const quickStatus = document.getElementById("quick-theme-status");
  const quickItems = [...(quickMenu?.querySelectorAll("[data-theme-choice]") || [])];
  const nativePopover = typeof quickMenu?.showPopover === "function" && typeof quickMenu?.hidePopover === "function";
  let quickOpen = false;
  if (quickMenu && !nativePopover) { quickMenu.removeAttribute("popover");quickMenu.hidden = true; }
  let sessionOnly = false;
  const updateStatus = () => {
    const message = sessionOnly
      ? t("Theme applied for this session. Storage is unavailable.")
      : t("Your theme is saved on this device.");
    if (status) status.textContent = message;
    if (quickStatus) quickStatus.textContent = message;
    if (quickLabel) quickLabel.textContent = t("Themes");
    quickButton?.setAttribute("aria-label", t("Themes"));
    for (const item of quickItems) {
      const label = item.querySelector("[data-theme-label]");
      if (label) label.textContent = t(themeLabels[item.dataset.themeChoice]);
    }
  };
  const apply = (value, persist = false) => applyTheme(value, {document, window, storage, persist});
  apply(readTheme(storage));
  const stopGlass = glass({document, window});
  const choose = value => { sessionOnly = !apply(value, true).saved; updateStatus(); };
  const change = () => choose(select.value);
  const selectedItem = () => quickItems.find(item => item.dataset.themeChoice === document.documentElement.dataset.theme) || quickItems[0];
  const positionQuickMenu = () => {
    if (!quickButton || !quickMenu) return;
    const bounds = quickButton.getBoundingClientRect();
    const width = Math.min(288, window.innerWidth - 24);
    const top = Math.max(12, Math.min(bounds.bottom + 8, window.innerHeight - Math.min(360, window.innerHeight - 24)));
    quickMenu.style.width = width + "px";
    quickMenu.style.left = Math.max(12, Math.min(bounds.right - width, window.innerWidth - width - 12)) + "px";
    quickMenu.style.top = top + "px";
    quickMenu.style.maxHeight = Math.max(80, window.innerHeight - top - 12) + "px";
  };
  const closeQuickMenu = (returnFocus = false) => {
    if (!quickOpen) return;
    if (nativePopover) quickMenu.hidePopover();
    else { quickMenu.hidden = true;delete quickMenu.dataset.open; }
    quickOpen = false;quickButton?.setAttribute("aria-expanded", "false");
    if (returnFocus) quickButton?.focus();
  };
  const showQuickMenu = () => {
    if (!quickMenu || quickOpen) return;
    positionQuickMenu();
    if (nativePopover) quickMenu.showPopover();
    else { quickMenu.hidden = false;quickMenu.dataset.open = "true"; }
    quickOpen = true;quickButton?.setAttribute("aria-expanded", "true");selectedItem()?.focus();
  };
  const quickToggle = () => quickOpen ? closeQuickMenu() : showQuickMenu();
  const triggerKeys = event => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();showQuickMenu();
    (event.key === "ArrowUp" ? quickItems.at(-1) : quickItems[0])?.focus();
  };
  const menuKeys = event => {
    if (event.key === "Escape") { event.preventDefault();event.stopPropagation();closeQuickMenu(true);return; }
    if (event.key === "Tab") { closeQuickMenu();return; }
    const index = quickItems.indexOf(event.target);
    if (index < 0) return;
    const destination = event.key === "ArrowDown" ? (index + 1) % quickItems.length
      : event.key === "ArrowUp" ? (index + quickItems.length - 1) % quickItems.length
      : event.key === "Home" ? 0 : event.key === "End" ? quickItems.length - 1 : -1;
    if (destination >= 0) { event.preventDefault();quickItems[destination].focus(); }
  };
  const menuToggle = event => {
    quickOpen = event.newState === "open";quickButton?.setAttribute("aria-expanded", String(quickOpen));
  };
  const outsideClick = event => {
    if (!nativePopover && quickOpen && !quickMenu.contains(event.target) && !quickButton.contains(event.target)) closeQuickMenu();
  };
  const itemClicks = quickItems.map(item => {
    const click = () => { choose(item.dataset.themeChoice);closeQuickMenu(true); };
    item.addEventListener("click", click);return [item, click];
  });
  quickButton?.addEventListener("click", quickToggle);
  quickButton?.addEventListener("keydown", triggerKeys);
  quickMenu?.addEventListener("keydown", menuKeys);
  quickMenu?.addEventListener("toggle", menuToggle);
  document.addEventListener("pointerdown", outsideClick);
  window.addEventListener("resize", positionQuickMenu);
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
    closeQuickMenu();
    for (const [item, click] of itemClicks) item.removeEventListener("click", click);
    quickButton?.removeEventListener("click", quickToggle);
    quickButton?.removeEventListener("keydown", triggerKeys);
    quickMenu?.removeEventListener("keydown", menuKeys);
    quickMenu?.removeEventListener("toggle", menuToggle);
    document.removeEventListener("pointerdown", outsideClick);
    window.removeEventListener("resize", positionQuickMenu);
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
