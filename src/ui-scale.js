// The interface size chosen in Settings (90 to 125 %). It is stored on this device and every Deviload window
// applies it as it opens, through the web view's own zoom, so text, icons and spacing grow together.
export const UI_SCALE_KEY = "deviload-ui-scale";
export const UI_SCALES = [0.9, 1, 1.1, 1.25];

export function readUiScale(storage = globalThis.localStorage) {
  try {
    const value = Number(storage?.getItem(UI_SCALE_KEY));
    return UI_SCALES.includes(value) ? value : 1;
  } catch {
    return 1;
  }
}

export function applyUiScale(scale, invoke = globalThis.window?.__TAURI__?.core?.invoke) {
  if (!invoke || !UI_SCALES.includes(scale)) return Promise.resolve(false);
  return invoke("set_ui_scale", { scale })
    .then(() => true)
    .catch(() => false);
}

export function saveUiScale(scale, storage = globalThis.localStorage) {
  if (!UI_SCALES.includes(scale)) return false;
  try {
    storage?.setItem(UI_SCALE_KEY, String(scale));
  } catch {
    /* This session only. */
  }
  return true;
}
