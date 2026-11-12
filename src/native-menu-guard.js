// The web view's own menu (Back, Reload, Save as, Print, Inspect) and its keys are not part of Deviload: reloading
// or going back would throw away the player and the downloads view. Right-click keeps the browser menu only in
// text fields, for cut, copy and paste, and over selected text. Deviload's own menus handle the event first; these
// listeners sit on the window, after them.
const editable = target =>
  target?.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable=""]');

window.addEventListener("contextmenu", event => {
  if (event.defaultPrevented || editable(event.target)) return;
  if (String(globalThis.getSelection?.() || "").trim()) return;
  event.preventDefault();
});

export function browserKey(event) {
  const key = String(event.key || "").toLowerCase(),
    control = event.ctrlKey || event.metaKey;
  if (
    key === "f5" ||
    key === "f12" ||
    key === "browserback" ||
    key === "browserforward" ||
    key === "browserrefresh"
  )
    return true;
  if (event.altKey && (key === "arrowleft" || key === "arrowright")) return true;
  if (control && ["r", "p", "s", "u", "o", "f", "g", "j"].includes(key) && !event.altKey) return true;
  if (control && event.shiftKey && ["i", "j", "c", "delete"].includes(key)) return true;
  return false;
}

// Bubbling to the window, so a key Deviload uses itself (F5 refreshes the music) has already been handled.
window.addEventListener("keydown", event => {
  if (browserKey(event)) event.preventDefault();
});
