import { t, onLanguageChange } from "./i18n.js";

// The common scrobbling rule: a song counts once it played for half its length or four minutes,
// whichever comes first. Songs shorter than 30 seconds never count.
export function scrobblePoint(duration) {
  return Number.isFinite(duration) && duration >= 30 ? Math.min(duration / 2, 240) : Infinity;
}

// Follows one play at a time. Only forward playback counts, so seeking ahead never fakes a listen,
// and a repeated song that starts over is a new play.
export function createPlayTracker() {
  let play = null;
  return {
    step({ key, time, duration, playing, now }) {
      if (!key || !Number.isFinite(time)) return null;
      const restarted = play?.key === key && time < 5 && play.last > Math.max(10, duration - 8);
      if (play?.key !== key || restarted)
        play = { key, last: time, heard: 0, at: Math.floor(now), announced: false, sent: false };
      const delta = time - play.last;
      play.last = time;
      if (!playing) return null;
      if (delta > 0 && delta < 2.5) play.heard += delta;
      if (!play.announced) {
        play.announced = true;
        return "start";
      }
      if (!play.sent && play.heard >= scrobblePoint(duration)) {
        play.sent = true;
        return "listen";
      }
      return null;
    },
    get startedAt() {
      return play?.at ?? 0;
    },
  };
}

export function scrobbleTrack(track, duration, at) {
  const album =
    typeof track?.album === "string" ? track.album : track?.album?.title || track?.album?.name || "";
  const artist = (Array.isArray(track?.artists) ? track.artists[0] : track?.artist) || "";
  if (!track?.title || !artist) return null;
  return {
    title: String(track.title),
    artist: String(artist),
    ...(album ? { album: String(album) } : {}),
    ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
    ...(at ? { at } : {}),
    id: String(track.id || ""),
  };
}

export function wireScrobbling({
  invoke,
  host,
  before = null,
  nodes,
  getAudio,
  getTrack,
  isPrivate = () => false,
  notify = () => {},
}) {
  let state = { listenbrainz: null, lastfm: null, lastfmAvailable: false, lastfmWaiting: false, pending: 0 },
    busy = false;
  const tracker = createPlayTracker();
  const connected = () => !!(state.listenbrainz || state.lastfm);
  for (const node of nodes)
    node.addEventListener("timeupdate", () => {
      if (node !== getAudio()) return;
      const track = getTrack();
      const event = tracker.step({
        key: track?.id,
        time: node.currentTime,
        duration: node.duration,
        playing: !node.paused && !node.seeking,
        now: Date.now() / 1000,
      });
      // A private session leaves no trace anywhere, including the person's own profiles.
      if (!event || !connected() || isPrivate()) return;
      const item = scrobbleTrack(track, node.duration, event === "listen" ? tracker.startedAt : 0);
      if (!item) return;
      invoke(event === "listen" ? "scrobble_listen" : "scrobble_now_playing", { track: item })
        .then(() => event === "listen" && refreshStatus())
        .catch(() => {});
    });

  const box = document.createElement("details");
  box.className = "music-profile music-scrobbling";
  const summary = document.createElement("summary"),
    intro = document.createElement("p"),
    note = document.createElement("p"),
    message = document.createElement("p");
  message.role = "status";
  note.className = "music-scrobbling-note";
  const row = name => {
    const wrap = document.createElement("div"),
      title = document.createElement("strong"),
      text = document.createElement("span"),
      actions = document.createElement("div");
    wrap.className = "music-scrobbling-service";
    wrap.dataset.service = name;
    actions.className = "setting-actions";
    title.textContent = name === "lastfm" ? "Last.fm" : "ListenBrainz";
    title.translate = false;
    wrap.append(title, text, actions);
    return { wrap, text, actions };
  };
  const brainz = row("listenbrainz"),
    lastfm = row("lastfm");
  box.append(summary, intro, brainz.wrap, lastfm.wrap, note, message);
  host?.insertBefore(box, before);

  const action = (label, cls, run) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = cls;
    button.textContent = label;
    button.disabled = busy;
    button.addEventListener("click", async () => {
      if (busy) return;
      busy = true;
      render();
      message.textContent = "";
      try {
        const next = await run();
        if (next && typeof next === "object") state = next;
      } catch (error) {
        message.textContent = t(String(error?.message || error));
      } finally {
        busy = false;
        render();
      }
    });
    return button;
  };
  const token = document.createElement("input");
  token.type = "password";
  token.autocomplete = "off";
  token.spellcheck = false;
  token.maxLength = 128;

  function render() {
    summary.textContent = t("Scrobbling · ListenBrainz and Last.fm");
    intro.textContent = t(
      "Send the songs you listen to your own ListenBrainz or Last.fm profile. Nothing is sent in a private session, and your sign-in stays on this computer.",
    );
    token.placeholder = token.ariaLabel = t("ListenBrainz user token");
    if (state.listenbrainz) {
      brainz.text.textContent = t("Connected as {name}", { name: state.listenbrainz });
      brainz.actions.replaceChildren(
        action(t("Disconnect"), "quiet small", () =>
          invoke("scrobble_disconnect", { service: "listenbrainz" }),
        ),
      );
    } else {
      brainz.text.textContent = t("Paste the user token from your ListenBrainz settings.");
      brainz.actions.replaceChildren(
        token,
        action(t("Connect"), "outline small", async () => {
          const value = token.value.trim();
          if (!value) throw Error(t("Paste the user token from your ListenBrainz settings."));
          const next = await invoke("scrobble_connect_listenbrainz", { token: value });
          token.value = "";
          notify(t("Scrobbling to ListenBrainz is on."));
          return next;
        }),
        action(t("Find my token"), "quiet small", () =>
          invoke("scrobble_open_help", { service: "listenbrainz" }),
        ),
      );
    }
    if (state.lastfm) {
      lastfm.text.textContent = t("Connected as {name}", { name: state.lastfm });
      lastfm.actions.replaceChildren(
        action(t("Disconnect"), "quiet small", () => invoke("scrobble_disconnect", { service: "lastfm" })),
      );
    } else if (!state.lastfmAvailable) {
      lastfm.text.textContent = t("Last.fm arrives in a later update.");
      lastfm.actions.replaceChildren();
    } else if (state.lastfmWaiting) {
      lastfm.text.textContent = t("Allow Deviload on the Last.fm page that opened, then press Done.");
      lastfm.actions.replaceChildren(
        action(t("Done"), "outline small", async () => {
          const next = await invoke("scrobble_lastfm_finish");
          notify(t("Scrobbling to Last.fm is on."));
          return next;
        }),
        action(t("Cancel"), "quiet small", () => invoke("scrobble_disconnect", { service: "lastfm" })),
      );
    } else {
      lastfm.text.textContent = t("Sign in on the Last.fm website; Deviload never sees your password.");
      lastfm.actions.replaceChildren(
        action(t("Connect"), "outline small", async () => {
          await invoke("scrobble_lastfm_begin");
          return { ...state, lastfmWaiting: true };
        }),
      );
    }
    note.textContent = state.pending
      ? t("{count} songs are waiting for a connection and will be sent later.", { count: state.pending })
      : "";
    note.hidden = !state.pending;
  }
  async function refreshStatus() {
    try {
      state = await invoke("scrobble_status");
    } catch {
      /* Scrobbling is optional; the player works without it. */
    }
    if (!busy) render();
  }
  render();
  refreshStatus();
  onLanguageChange(render);
  return { refresh: refreshStatus };
}
