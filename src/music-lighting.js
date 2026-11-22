import { t, tn, onLanguageChange } from "./i18n.js";

// RGB lighting that follows the music through OpenRGB on this computer: every keyboard, mouse, strip and fan it
// drives takes the colour of the song's cover and pulses with the bass. Off until the person turns it on; when
// turned off (or Deviload closes) the devices get their own effects back. When OpenRGB is installed but not
// running, Deviload starts it in the tray by itself, so turning the switch on is the whole setup.
export const LIGHTING_KEY = "deviload-music-lighting";
// Where OpenRGB was found or chosen, so the next start goes straight to it.
export const OPENRGB_KEY = "deviload-music-lighting-openrgb";

// "hsl(210 78% 80%)" (the cover colour the lyrics already use) to a vivid RGB for LEDs, which look washed out
// unless fully saturated. Grey covers stay a soft white.
export function coverRgb(value) {
  const match = /hsl\(\s*([\d.]+)/.exec(String(value || ""));
  if (!match) return [255, 236, 230];
  const h = Number(match[1]) % 360,
    s = 1,
    l = 0.5;
  const k = n => (n + h / 30) % 12,
    a = s * Math.min(l, 1 - l),
    f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)].map(v => Math.round(v * 255));
}

// The bass becomes a brightness that jumps up on a hit and falls back slower. Real LEDs look washed out when dim,
// so the lights stay at least half bright while music plays and reach full brightness on a hit.
export function createPulse() {
  let level = 0;
  return {
    next(bass, playing) {
      const target = playing ? Math.max(0, Math.min(1, ((Number(bass) || 0) - 0.15) / 0.5)) ** 1.1 : 0;
      level += (target - level) * (target > level ? 0.65 : 0.14);
      return playing ? 0.5 + 0.5 * level : 0.4;
    },
    reset() {
      level = 0;
    },
  };
}

// The colour sent to the lights: the cover colour at [brightness], a little whiter on the strongest hits.
export function lightColour(rgb, brightness) {
  const glare = Math.max(0, brightness - 0.85) / 0.15;
  return rgb.map(v => Math.round(Math.min(255, (v + (255 - v) * glare * 0.25) * brightness)));
}

// What the start answered, as the state the settings row shows. A server that answers without lights is "empty".
export function lightingState(status) {
  if (status?.connected) return status.devices?.length ? "on" : "empty";
  return { missing: "missing", server_off: "server-off", starting: "starting" }[status?.error] || "lost";
}

// How long to wait before looking again: OpenRGB may finish starting, get its server turned on or be installed.
export function retryDelay(state) {
  return { starting: 3000, "server-off": 5000, missing: 30000 }[state] || 15000;
}

export function wireMusicLighting({ host, invoke, sound, getAudio, storage = globalThis.localStorage }) {
  const read = key => {
    try {
      return storage?.getItem(key) || "";
    } catch {
      return "";
    }
  };
  const write = (key, value) => {
    try {
      storage?.setItem(key, value);
    } catch {}
  };
  let enabled = read(LIGHTING_KEY) === "true";
  // The usual settings row: the switch with its name, a note under it, and buttons only while OpenRGB is missing.
  const box = document.createElement("div"),
    row = document.createElement("label"),
    toggle = document.createElement("input"),
    name = document.createElement("span"),
    note = document.createElement("p"),
    actions = document.createElement("div"),
    download = document.createElement("button"),
    choose = document.createElement("button");
  box.className = "music-catalog-context music-lighting";
  toggle.type = "checkbox";
  toggle.checked = enabled;
  actions.className = "setting-actions";
  for (const button of [download, choose]) {
    button.type = "button";
    button.className = "outline small";
  }
  row.append(toggle, name);
  actions.append(download, choose);
  box.append(row, note, actions);
  host?.append(box);

  let state = "off",
    devices = [],
    timer = 0,
    retry = 0,
    last = "",
    busy = false,
    sending = false;
  const pulse = createPulse();
  function noteText() {
    switch (state) {
      case "connecting":
        return t("Looking for OpenRGB…");
      case "starting":
        return t("Starting OpenRGB…");
      case "missing":
        return t(
          "Lighting works through OpenRGB, a free program for keyboards, mice and strips. Download it and unpack it anywhere: Deviload finds it and starts it by itself.",
        );
      case "server-off":
        return t(
          "OpenRGB is open, but its SDK server is off. Turn it on in OpenRGB (SDK Server, Start Server) or close OpenRGB and Deviload starts it by itself.",
        );
      case "empty":
        return t("OpenRGB found no lights. Check that your device is on the list at openrgb.org.");
      case "lost":
        return t("Lost OpenRGB. Trying again…");
      case "on":
        return tn(
          "Lighting: {count} device · {names}",
          "Lighting: {count} devices · {names}",
          devices.length,
          {
            names: devices.slice(0, 3).join(", "),
          },
        );
      default:
        return t(
          "Your keyboard, mouse and strips take the cover's colour and pulse with the bass. Works through OpenRGB.",
        );
    }
  }
  function label() {
    name.textContent = t("RGB lighting follows the music");
    note.textContent = noteText();
    download.textContent = t("Download OpenRGB");
    choose.textContent = t("Choose OpenRGB…");
    actions.hidden = state !== "missing";
  }
  async function connect() {
    clearTimeout(retry);
    if (!enabled || busy) return;
    busy = true;
    // Finding OpenRGB, starting it and waiting for its devices can take a few seconds.
    if (state !== "starting") state = "connecting";
    label();
    const status = await invoke("music_lighting_start", { openrgb: read(OPENRGB_KEY) || null }).catch(
      () => null,
    );
    busy = false;
    if (!enabled) {
      invoke("music_lighting_stop").catch(() => {});
      return;
    }
    if (status?.openrgb) write(OPENRGB_KEY, status.openrgb);
    devices = status?.devices || [];
    state = lightingState(status);
    label();
    if (state === "on") loop();
    else retry = setTimeout(connect, retryDelay(state));
  }
  async function loop() {
    clearTimeout(timer);
    if (!enabled || state !== "on") return;
    const audio = getAudio(),
      playing = !!audio && !audio.paused && !audio.ended;
    const signal = playing ? sound.analyse(audio) : null;
    const rgb = coverRgb(getComputedStyle(document.documentElement).getPropertyValue("--cover-lyric-light"));
    const colour = lightColour(rgb, pulse.next(signal?.bass, playing));
    const key = colour.join(",");
    if (key !== last && !sending) {
      last = key;
      sending = true;
      const ok = await invoke("music_lighting_set", { r: colour[0], g: colour[1], b: colour[2] }).catch(
        () => false,
      );
      sending = false;
      if (!ok) {
        state = "lost";
        label();
        retry = setTimeout(connect, 5000);
        return;
      }
    }
    // Fast while music plays; a slow heartbeat on pause just keeps the colour in step with the cover.
    timer = setTimeout(loop, playing ? 40 : 500);
  }
  function stop() {
    clearTimeout(timer);
    clearTimeout(retry);
    state = "off";
    last = "";
    pulse.reset();
    invoke("music_lighting_stop").catch(() => {});
    label();
  }
  async function start() {
    // The bass is read from the same sound graph the visualiser uses.
    await sound.enableAnalysis().catch(() => {});
    connect();
  }
  toggle.addEventListener("change", () => {
    enabled = toggle.checked;
    write(LIGHTING_KEY, String(enabled));
    if (enabled) start();
    else stop();
  });
  download.addEventListener("click", () => invoke("music_lighting_get_openrgb").catch(() => {}));
  choose.addEventListener("click", async () => {
    const path = await invoke("music_lighting_choose_openrgb").catch(() => null);
    if (!path) return;
    write(OPENRGB_KEY, path);
    if (enabled) connect();
  });
  label();
  onLanguageChange(label);
  if (enabled)
    // Analysis needs a user gesture to start the audio graph, so the first click on the page wakes it.
    document.addEventListener("pointerdown", start, { once: true });
  return { stop };
}
