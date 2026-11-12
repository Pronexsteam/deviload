import { t, onLanguageChange } from "./i18n.js";

// RGB lighting that follows the music through OpenRGB on this computer: every keyboard, mouse, strip and fan it
// drives takes the colour of the song's cover and pulses with the bass. Off until the person turns it on; when
// turned off (or Deviload closes) the devices get their own effects back.
export const LIGHTING_KEY = "deviload-music-lighting";

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

// The bass becomes a brightness that jumps up on a hit and falls back slower, never fully dark while playing.
export function createPulse() {
  let level = 0;
  return {
    next(bass, playing) {
      const target = playing ? Math.max(0, Math.min(1, ((Number(bass) || 0) - 0.22) / 0.6)) ** 1.3 : 0;
      level += (target - level) * (target > level ? 0.6 : 0.12);
      return playing ? 0.18 + 0.82 * level : 0.25;
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

export function wireMusicLighting({ host, invoke, sound, getAudio, storage = globalThis.localStorage }) {
  let enabled = false;
  try {
    enabled = storage?.getItem(LIGHTING_KEY) === "true";
  } catch {}
  const box = document.createElement("label"),
    toggle = document.createElement("input"),
    copy = document.createElement("span"),
    name = document.createElement("strong"),
    note = document.createElement("small");
  box.className = "music-catalog-context music-lighting";
  toggle.type = "checkbox";
  toggle.checked = enabled;
  copy.append(name, note);
  box.append(toggle, copy);
  host?.append(box);

  let state = "off",
    devices = [],
    timer = 0,
    retry = 0,
    last = "",
    sending = false;
  const pulse = createPulse();
  function label() {
    name.textContent = t("RGB lighting follows the music");
    note.textContent =
      state === "on"
        ? t("Lighting: {count} devices · {names}", {
            count: devices.length,
            names: devices.slice(0, 3).join(", "),
          })
        : state === "connecting"
          ? t("Looking for OpenRGB…")
          : state === "missing"
            ? t("OpenRGB was not found. Start OpenRGB (openrgb.org) and turn on its SDK server.")
            : t(
                "Your keyboard, mouse and strips take the cover's colour and pulse with the bass. Works through OpenRGB.",
              );
  }
  async function connect() {
    if (!enabled || state === "connecting") return;
    state = "connecting";
    label();
    const status = await invoke("music_lighting_start").catch(() => ({ connected: false }));
    if (!enabled) {
      invoke("music_lighting_stop").catch(() => {});
      return;
    }
    devices = status?.devices || [];
    state = status?.connected ? "on" : "missing";
    label();
    if (state === "on") loop();
    // OpenRGB may be started later; it is looked for again now and then.
    else retry = setTimeout(connect, 15000);
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
        state = "missing";
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
  toggle.addEventListener("change", async () => {
    enabled = toggle.checked;
    try {
      storage?.setItem(LIGHTING_KEY, String(enabled));
    } catch {}
    if (enabled) {
      // The bass is read from the same sound graph the visualiser uses.
      await sound.enableAnalysis().catch(() => {});
      connect();
    } else stop();
  });
  label();
  onLanguageChange(label);
  if (enabled)
    // Analysis needs a user gesture to start the audio graph, so the first click on the page wakes it.
    document.addEventListener(
      "pointerdown",
      () => {
        sound.enableAnalysis().catch(() => {});
        connect();
      },
      { once: true },
    );
  return { stop };
}
