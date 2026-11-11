import { t, errorText, onLanguageChange } from "./i18n.js";

// Casting to a TV or speaker at home (Chromecast or DLNA). The player here keeps running silently, so the queue,
// lyrics, history and every control work as usual; the device plays the same song and follows play, pause, seeking,
// volume and track changes. Stopping casting brings the sound back here.
let casting = false;
export const isCasting = () => casting;

// How far the device may drift from the player here before it is asked to catch up, in seconds.
export const DRIFT_SECONDS = 4;
export function needsResync(device, local, now, lastResync) {
  return (
    device?.state === "playing" &&
    Number.isFinite(local) &&
    Math.abs(device.position - local) > DRIFT_SECONDS &&
    now - lastResync > 10000
  );
}

export function createMusicCast({
  invoke,
  button,
  decks,
  getState,
  notify = () => {},
  poll = setInterval,
  stopPoll = clearInterval,
}) {
  let device = null,
    lastSrc = "",
    timer = null,
    lastResync = 0,
    muted = [],
    reportedError = false,
    volumeTimer = null,
    lastVolume = 0;
  const trigger = button(t("Cast to a TV or speaker"), "cast", () => open());
  trigger.id = "music-cast-open";
  trigger.setAttribute("aria-pressed", "false");
  const badge = button(t("Casting"), "cast", () => open());
  badge.classList.add("music-cast-badge");
  badge.hidden = true;
  const badgeText = document.createElement("span");
  badge.append(badgeText);

  const dialog = document.createElement("dialog");
  dialog.className = "music-cast-dialog";
  const heading = document.createElement("h2"),
    help = document.createElement("p"),
    list = document.createElement("div"),
    state = document.createElement("p");
  list.className = "music-cast-devices";
  state.setAttribute("role", "status");
  const close = button(t("Close"), "x-circle", () => dialog.close());
  const head = document.createElement("div");
  head.className = "dialog-head";
  head.append(heading, close);
  const again = button(t("Look again"), null, () => search(), "outline small");
  const stop = button(t("Stop casting"), null, () => end(true), "outline small");
  dialog.append(head, help, state, list, again, stop);
  document.body.append(dialog);

  function label() {
    const text = device ? t("Casting to {device}", { device: device.name }) : t("Cast to a TV or speaker");
    // The menu shows a short name; the full one is the tooltip.
    trigger.title = text;
    trigger.ariaLabel = device ? t("Casting to {device}", { device: device.name }) : t("TV and speakers");
    badge.title = badge.ariaLabel = text;
    badgeText.textContent = device?.name || "";
    heading.textContent = device
      ? t("Casting to {device}", { device: device.name })
      : t("Cast to a TV or speaker");
    help.textContent = device
      ? t("The sound plays on the device. Controls here steer it.")
      : t("TVs and speakers with Chromecast or DLNA on the same Wi-Fi as this computer.");
  }
  label();
  onLanguageChange(label);

  const track = () => {
    const audio = decks.current,
      info = getState();
    return {
      id: info.id || "",
      url: audio.currentSrc || audio.src || "",
      title: info.title || "",
      artist: info.artist || "",
      image: info.image || "",
      position: audio.currentTime || 0,
      playing: !audio.paused,
    };
  };

  async function search() {
    list.replaceChildren();
    state.textContent = t("Looking for TVs and speakers…");
    again.disabled = true;
    try {
      const devices = await invoke("music_cast_devices");
      state.textContent = devices.length
        ? ""
        : t("No TVs or speakers found. They must be on the same Wi-Fi as this computer.");
      for (const found of devices) {
        const choice = button(
          found.name,
          found.kind === "cast" ? "cast" : "monitor",
          () => start(found),
          "music-cast-device",
        );
        const name = document.createElement("span");
        name.textContent = found.name;
        const kind = document.createElement("small");
        kind.textContent = found.kind === "cast" ? "Chromecast" : "DLNA";
        choice.append(name, kind);
        list.append(choice);
      }
    } catch (error) {
      state.textContent = errorText(error);
    } finally {
      again.disabled = false;
    }
  }

  function open() {
    label();
    stop.hidden = !device;
    again.hidden = !!device;
    list.replaceChildren();
    state.textContent = "";
    if (!dialog.open) dialog.showModal();
    if (!device) search();
  }

  async function start(found) {
    const now = track();
    if (!now.url) return (state.textContent = t("Start a song first, then cast it."));
    state.textContent = t("Connecting to {device}…", { device: found.name });
    try {
      await invoke("music_cast_start", { device: found.id, ...now });
    } catch (error) {
      state.textContent = errorText(error);
      return;
    }
    device = found;
    casting = true;
    lastSrc = now.url;
    lastVolume = decks.current.volume;
    reportedError = false;
    // Silence the player here; it keeps time for lyrics, history and the queue.
    muted = decks.nodes.map(node => [node, node.muted]);
    for (const node of decks.nodes) node.muted = true;
    trigger.setAttribute("aria-pressed", "true");
    badge.hidden = false;
    label();
    dialog.close();
    notify(t("Casting to {device}", { device: found.name }));
    timer = poll(check, 2000);
  }

  async function end(ask) {
    if (!device) return;
    const name = device.name;
    device = null;
    casting = false;
    if (timer) stopPoll(timer);
    timer = null;
    for (const [node, value] of muted) node.muted = value;
    muted = [];
    trigger.setAttribute("aria-pressed", "false");
    badge.hidden = true;
    label();
    if (dialog.open) dialog.close();
    if (ask) await invoke("music_cast_control", { action: "stop" }).catch(() => {});
    notify(t("Casting to {device} ended.", { device: name }));
  }

  const control = (action, value) =>
    device &&
    invoke("music_cast_control", value == null ? { action } : { action, value }).catch(error =>
      notify(errorText(error), true),
    );

  async function check() {
    if (!device) return;
    let status;
    try {
      status = await invoke("music_cast_status");
    } catch {
      return;
    }
    if (!device) return;
    if (!status || status.state === "gone") return end(false);
    if (status.error && !reportedError) {
      reportedError = true;
      notify(t("{device} could not play this song.", { device: device.name }), true);
    }
    const audio = decks.current;
    if (needsResync(status, audio.currentTime, Date.now(), lastResync)) {
      lastResync = Date.now();
      control("seek", audio.currentTime);
    }
  }

  // A new song on the player here goes to the device.
  async function follow() {
    if (!device) return;
    const now = track();
    if (!now.url || now.url === lastSrc) return;
    lastSrc = now.url;
    reportedError = false;
    for (const node of decks.nodes) node.muted = true;
    try {
      await invoke("music_cast_load", now);
    } catch (error) {
      notify(errorText(error), true);
    }
  }
  decks.listen("loadedmetadata", follow);
  decks.listen("play", () => {
    if (!device) return;
    if (track().url !== lastSrc) follow();
    else control("play");
  });
  decks.listen("pause", () => {
    if (device && !decks.current.ended) control("pause");
  });
  decks.listen("seeked", () => {
    if (device) control("seek", decks.current.currentTime);
  });
  decks.listen("volumechange", () => {
    // Muting here fires this too; only a real change of the level reaches the device, the last of a drag.
    const level = decks.current.volume;
    if (!device || Math.abs(level - lastVolume) < 0.01) return;
    lastVolume = level;
    clearTimeout(volumeTimer);
    volumeTimer = setTimeout(() => control("volume", level), 250);
  });

  return {
    trigger,
    badge,
    open,
    end,
    get device() {
      return device;
    },
  };
}
