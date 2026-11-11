import { t, errorText, onLanguageChange } from "./i18n.js";

// Keeps Liked songs in step with YouTube Music, one way only: songs liked there are added here, and nothing is ever
// removed here or changed in the account. Off until the person turns it on; then once a day, or at once by button.
// A song is brought over once: removing it from Liked songs here is not undone by the next day's reading.
export const LIKES_SYNC_KEY = "deviload-music-likes-sync-v1";
export const LIKES_SYNC_LIMIT = 200;
const DAY = 86400000,
  SEEN = 5000;

export function readLikesSync(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(LIKES_SYNC_KEY) || "{}");
    return {
      enabled: value?.enabled === true,
      last: Number.isFinite(value?.last) ? value.last : 0,
      seen: Array.isArray(value?.seen) ? value.seen.filter(id => typeof id === "string").slice(-SEEN) : [],
    };
  } catch {
    return { enabled: false, last: 0, seen: [] };
  }
}

// `add(songs)` puts the given songs into Liked songs and says how many were new there.
export function createLikesSync({
  invoke,
  add,
  storage = globalThis.localStorage,
  now = Date.now,
  notify = () => {},
}) {
  let state = readLikesSync(storage),
    running = null;
  const listeners = new Set();
  const changed = () => listeners.forEach(listener => listener());
  const save = () => {
    try {
      storage?.setItem(LIKES_SYNC_KEY, JSON.stringify(state));
    } catch {
      /* Without storage the sync still runs; it only forgets its last time. */
    }
  };
  function sync({ quiet = false } = {}) {
    running ||= (async () => {
      changed();
      try {
        const result = await invoke("music_youtube_liked", { limit: LIKES_SYNC_LIMIT });
        const seen = new Set(state.seen);
        const fresh = (Array.isArray(result?.entries) ? result.entries : []).filter(
          entry => typeof entry?.videoId === "string" && !seen.has(entry.videoId),
        );
        const added = fresh.length ? await add(fresh) : 0;
        state = {
          ...state,
          last: now(),
          seen: [...state.seen, ...fresh.map(entry => entry.videoId)].slice(-SEEN),
        };
        save();
        if (added || !quiet)
          notify(
            added
              ? t("New likes from YouTube Music: {count}", { count: added })
              : t("Liked songs are up to date."),
          );
        return added;
      } catch (error) {
        if (!quiet) notify(errorText(error), true);
        throw error;
      } finally {
        running = null;
        changed();
      }
    })();
    return running;
  }
  return {
    get enabled() {
      return state.enabled;
    },
    get last() {
      return state.last;
    },
    get running() {
      return !!running;
    },
    onChange(listener) {
      listeners.add(listener);
    },
    setEnabled(value) {
      state = { ...state, enabled: !!value };
      save();
      changed();
      if (value) sync().catch(() => {});
    },
    sync,
    // On start and from time to time: once a day has passed since the last reading, while it is turned on.
    // A quiet failure (signed out, offline) waits for the next time.
    maybe() {
      return state.enabled && now() - state.last >= DAY
        ? sync({ quiet: true }).catch(() => 0)
        : Promise.resolve(0);
    },
  };
}

// The switch and the button, under the YouTube Music account.
export function likesSyncControls(sync) {
  const box = document.createElement("div"),
    label = document.createElement("label"),
    toggle = document.createElement("input"),
    text = document.createElement("span"),
    now = document.createElement("button"),
    when = document.createElement("small");
  box.className = "music-account-addon music-likes-sync";
  toggle.type = "checkbox";
  label.className = "music-likes-sync-toggle";
  label.append(toggle, text);
  now.type = "button";
  now.className = "outline small";
  when.className = "music-likes-sync-when";
  box.append(label, now, when);
  toggle.addEventListener("change", () => sync.setEnabled(toggle.checked));
  now.addEventListener("click", () => sync.sync().catch(() => {}));
  const time = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });
  function render() {
    toggle.checked = sync.enabled;
    text.textContent = t("Bring new likes from YouTube Music once a day");
    now.textContent = sync.running ? t("Reading likes…") : t("Sync likes now");
    now.disabled = sync.running;
    when.textContent = sync.last ? t("Last synced: {time}", { time: time.format(sync.last) }) : "";
    when.hidden = !sync.last;
  }
  render();
  sync.onChange(render);
  onLanguageChange(render);
  return box;
}
