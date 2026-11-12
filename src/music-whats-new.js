import { t } from "./i18n.js";
import { showTip, tourSeen } from "./music-tour.js";

// New features, shown once to everyone, including people who update and never read the notes: a small dot sits
// on the control that leads to the feature, and the first time the person opens it a single tip points at the
// feature itself. After the tip (or a skip) the dot goes and the feature is never announced again.
export const NEWS = [
  {
    key: "new-sound-mood",
    entry: ".music-dock-more",
    target: ".music-vibe-row",
    title: () => t("New: sound moods"),
    text: () =>
      t("Slowed + reverb, Nightcore and 8D, one click away. The badge on the dock turns it back off."),
  },
  {
    key: "new-lyric-video",
    entry: ".music-lyric-card-open",
    target: '.music-lyric-card-dialog [data-format="video"]',
    title: () => t("New: lyric videos"),
    text: () =>
      t("Turn a few sung lines into a vertical video with the song's sound, ready for stories and shorts."),
  },
  {
    key: "new-taste-map",
    entry: ".music-sidebar-stats",
    target: '.music-stats-tabs [data-period="map"]',
    title: () => t("New: your taste map"),
    text: () => t("The artists you listen to as a galaxy. Bigger stars are the ones you play most."),
  },
];

const shown = node => node instanceof Element && node.getClientRects().length > 0;

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
