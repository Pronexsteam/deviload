import { t, onLanguageChange } from "./i18n.js";

// "Now playing" as a Windows notification when a new song starts while Deviload is in the tray or another window
// is in front. Off until the person turns it on in music settings; nothing is shown while they are looking at it.
export const SONG_NOTICE_KEY = "deviload-music-song-notice";

export function shouldAnnounce({ enabled, id, last, playing, hidden, focused }) {
  return !!enabled && !!id && id !== last && playing && (hidden || !focused);
}

export function wireSongNotice({
  host,
  storage = globalThis.localStorage,
  send = options => globalThis.window?.__TAURI__?.notification?.sendNotification(options),
}) {
  let enabled = false,
    last = "";
  try {
    enabled = storage?.getItem(SONG_NOTICE_KEY) === "true";
  } catch {}
  const box = document.createElement("label"),
    toggle = document.createElement("input"),
    copy = document.createElement("span"),
    name = document.createElement("strong"),
    note = document.createElement("small");
  box.className = "music-catalog-context music-song-notice";
  toggle.type = "checkbox";
  toggle.checked = enabled;
  copy.append(name, note);
  box.append(toggle, copy);
  host?.append(box);
  toggle.addEventListener("change", () => {
    enabled = toggle.checked;
    try {
      storage?.setItem(SONG_NOTICE_KEY, String(enabled));
    } catch {}
  });
  const label = () => {
    name.textContent = t("Show each new song in a notification");
    note.textContent = t("Only while Deviload is in the tray or behind another window.");
  };
  label();
  onLanguageChange(label);
  return {
    // Called whenever the player changes; announces a song once, when it starts unseen.
    update(item, playing) {
      const id = item?.id || "";
      if (
        shouldAnnounce({
          enabled,
          id,
          last,
          playing,
          hidden: document.hidden,
          focused: document.hasFocus?.() ?? true,
        })
      ) {
        last = id;
        Promise.resolve(
          send({
            title: String(item.title || "").slice(0, 120),
            body: String(item.subtitle || item.artists?.join(", ") || "").slice(0, 160),
          }),
        ).catch(() => {});
      } else if (playing && id) last = id;
    },
  };
}
