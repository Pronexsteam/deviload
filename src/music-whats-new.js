import { t } from "./i18n.js";
import { showTip, tourSeen } from "./music-tour.js";
import { rendered } from "./rendered.js";

// New features, shown once to everyone, including people who update and never read the notes: a small dot sits
// on the control that leads to the feature, and the first time the person opens it a single tip points at the
// feature itself. After the tip (or a skip) the dot goes and the feature is never announced again.
export const NEWS = [
  {
    key: "new-canvas",
    entry: "#music-expand",
    target: "#music-now-playing .music-canvas-toggle",
    title: () => t("New: Canvas"),
    text: () =>
      t("A looping piece of the song's video plays behind the full player. This button turns it off."),
  },
  {
    key: "new-live-theme",
    entry: "#quick-theme-button",
    target: '#quick-theme-menu [data-theme-choice="live"]',
    title: () => t("New: the Live theme"),
    text: () =>
      t(
        "The song's video plays behind the whole music page. Dimming and quality are at the bottom of this menu.",
      ),
  },
  {
    key: "new-locate-song",
    entry: ".music-dock .music-locate",
    target: ".music-dock .music-locate",
    title: () => t("New: find the song playing"),
    text: () => t("Scrolls the list to the song that plays and makes it glow. The J key does the same."),
  },
  {
    key: "new-download-progress",
    entry: ".music-dock .music-download-badge",
    target: ".music-dock .music-download-badge",
    title: () => t("New: download progress"),
    text: () => t("A song you download shows its progress here, then opens its folder in one click."),
  },
];

// Inside a closed menu or dialog it is hidden, and saying so takes only a selector match; the styles are asked only
// for a feature that may really be on screen. This runs on every frame the page changes while tips are pending.
// Behind an open window (the release notes, settings) a tip would point at something that cannot be reached.
const shown = node =>
  node instanceof Element &&
  !node.closest("dialog:not([open]), [popover]:not(:popover-open), [hidden]") &&
  [...node.ownerDocument.querySelectorAll("dialog[open]")].every(
    dialog => !dialog.matches(":modal") || dialog.contains(node),
  ) &&
  rendered(node);

export function wireWhatsNew({ storage = globalThis.localStorage, root = document } = {}) {
  let pending = NEWS.filter(item => !tourSeen(item.key, storage));
  if (!pending.length) return { check() {} };
  let busy = false;
  // Dots on the controls that lead to an unseen feature. Controls can be rebuilt, so this runs again on change.
  function mark() {
    for (const item of NEWS)
      for (const node of root.querySelectorAll(item.entry))
        node.toggleAttribute("data-news", pending.includes(item));
  }
  // When a feature comes into view, its tip is shown, one at a time.
  async function check() {
    if (busy) return;
    const item = pending.find(item => shown(root.querySelector(item.target)));
    if (!item) return;
    busy = true;
    // Let opening animations settle so the light lands on the final place.
    await new Promise(resolve => setTimeout(resolve, 420));
    const target = root.querySelector(item.target);
    if (shown(target)) {
      await showTip({
        key: item.key,
        target: () => root.querySelector(item.target),
        title: item.title(),
        text: item.text(),
        storage,
      });
      if (tourSeen(item.key, storage)) pending = pending.filter(other => other !== item);
      mark();
    }
    busy = false;
    if (pending.length) setTimeout(check, 300);
  }
  mark();
  // Menus and dialogs open through clicks and the open attribute; both are watched cheaply.
  // The page changes often (lyrics, the queue), so the work runs at most once per frame.
  let queued = 0;
  const observer = new MutationObserver(() => {
    if (!pending.length) {
      observer.disconnect();
      return;
    }
    queued ||= requestAnimationFrame(() => {
      queued = 0;
      mark();
      check();
    });
  });
  observer.observe(root.body || root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["open", "hidden", "aria-expanded"],
  });
  root.addEventListener("click", () => setTimeout(check, 60), true);
  return { check };
}
