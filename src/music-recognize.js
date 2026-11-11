import { t, errorText, onLanguageChange } from "./i18n.js";
import { SAMPLE_RATE, shazamSignature, toInt16 } from "./music-recognize-signature.js";

// "What's playing?": a microphone button in the music search. It listens for a few seconds, turns the sound into a
// fingerprint on this computer and sends only that fingerprint for recognition; the song found is then searched
// here. The recording itself never leaves the page and is dropped right after.
export const LISTEN_SECONDS = 10;

export async function recordSamples({
  seconds = LISTEN_SECONDS,
  signal,
  media = navigator.mediaDevices,
  Context = window.AudioContext,
}) {
  const stream = await media.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const context = new Context({ sampleRate: SAMPLE_RATE });
  const chunks = [];
  let length = 0;
  try {
    const source = context.createMediaStreamSource(stream),
      tap = context.createScriptProcessor(4096, 1, 1),
      mute = context.createGain();
    mute.gain.value = 0;
    // The browser may run the microphone at its own rate; the real one decides how much is enough.
    const needed = Math.round(seconds * context.sampleRate);
    await new Promise((resolve, reject) => {
      const stop = () => reject(Object.assign(new Error(), { name: "AbortError" }));
      if (signal?.aborted) return stop();
      signal?.addEventListener("abort", stop, { once: true });
      tap.onaudioprocess = event => {
        const data = event.inputBuffer.getChannelData(0);
        chunks.push(Float32Array.from(data));
        length += data.length;
        if (length >= needed) resolve();
      };
      source.connect(tap);
      tap.connect(mute);
      mute.connect(context.destination);
    });
    const all = new Float32Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      all.set(chunk, offset);
      offset += chunk.length;
    }
    return { samples: all, rate: context.sampleRate };
  } finally {
    for (const track of stream.getTracks()) track.stop();
    context.close().catch(() => {});
  }
}

// Linear resampling to 16 kHz when the microphone would not run at that rate.
export function resample(samples, rate) {
  if (rate === SAMPLE_RATE) return samples;
  const out = new Float32Array(Math.floor((samples.length * SAMPLE_RATE) / rate));
  for (let i = 0; i < out.length; i++) {
    const at = (i * rate) / SAMPLE_RATE,
      low = Math.floor(at),
      high = Math.min(low + 1, samples.length - 1);
    out[i] = samples[low] + (samples[high] - samples[low]) * (at - low);
  }
  return out;
}

export const quiet = samples => {
  let sum = 0;
  for (const value of samples) sum += value * value;
  return Math.sqrt(sum / Math.max(1, samples.length)) < 0.0015;
};

// The last songs found, kept on this computer only, newest first.
export const HISTORY_KEY = "deviload-recognized-v1";
export function readHistory(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(value)
      ? value.filter(item => item && typeof item.title === "string").slice(0, 100)
      : [];
  } catch {
    return [];
  }
}
export function rememberSong(song, source, storage = globalThis.localStorage, now = Date.now()) {
  const entry = {
    title: String(song.title || "").slice(0, 200),
    artist: String(song.artist || "").slice(0, 200),
    album: String(song.album || "").slice(0, 200),
    source,
    at: now,
  };
  const same = item => item.title === entry.title && item.artist === entry.artist;
  const list = [entry, ...readHistory(storage).filter(item => !same(item))].slice(0, 100);
  try {
    storage?.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    /* A full storage keeps recognition working; only the history is not kept. */
  }
  return list;
}
// Signed 16-bit samples sent from the app as base64 little-endian bytes.
export function samplesFromBase64(text) {
  const bytes = Uint8Array.from(atob(text || ""), char => char.charCodeAt(0));
  return new Int16Array(bytes.buffer, 0, bytes.length >> 1);
}
const quietInt = samples => {
  let sum = 0;
  for (const value of samples) sum += (value / 32768) * (value / 32768);
  return Math.sqrt(sum / Math.max(1, samples.length)) < 0.0015;
};

export function wireMusicRecognize({
  invoke,
  form,
  input,
  notify = () => {},
  record = recordSamples,
  like = null,
  storage = globalThis.localStorage,
}) {
  const button = document.createElement("button"),
    icon = document.createElement("span");
  button.type = "button";
  // Beside the search, not inside it, with a sound wave and a name: a microphone in a search field reads as
  // voice search. The search form is moved into the top bar while the app starts, so the button follows it.
  button.className = "music-recognize music-recognize-standalone";
  icon.className = "icon";
  icon.dataset.icon = "waveform";
  icon.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.className = "music-recognize-text";
  button.append(icon, text);
  // Where the sound comes from: the room, this computer or a file; and the songs found before.
  const menu = document.createElement("div");
  menu.className = "music-recognize-menu";
  menu.popover = "auto";
  const option = (key, glyph) => {
    const item = document.createElement("button"),
      mark = document.createElement("span"),
      copy = document.createElement("span"),
      name = document.createElement("strong"),
      hint = document.createElement("small");
    item.type = "button";
    item.className = "music-recognize-option";
    item.dataset.source = key;
    mark.className = "icon";
    mark.dataset.icon = glyph;
    mark.setAttribute("aria-hidden", "true");
    copy.append(name, hint);
    item.append(mark, copy);
    item.addEventListener("click", () => {
      menu.hidePopover?.();
      listen(key);
    });
    return { item, name, hint };
  };
  const sources = {
    microphone: option("microphone", "microphone"),
    computer: option("computer", "monitor"),
    file: option("file", "files"),
  };
  const recentTitle = document.createElement("p"),
    recent = document.createElement("div");
  recentTitle.className = "music-recognize-recent-title";
  recent.className = "music-recognize-recent";
  menu.append(sources.microphone.item, sources.computer.item, sources.file.item, recentTitle, recent);
  requestAnimationFrame(() => {
    form.after(button);
    button.after(menu);
  });
  button.addEventListener("click", () => {
    if (controller) return controller.abort();
    if (!menu.showPopover) return listen("microphone");
    renderRecent();
    const anchor = button.getBoundingClientRect();
    menu.style.top = `${Math.round(anchor.bottom + 8)}px`;
    menu.style.left = `${Math.round(Math.max(8, anchor.right - 300))}px`;
    menu.togglePopover();
  });
  function renderRecent() {
    const list = readHistory(storage).slice(0, 5);
    recentTitle.hidden = !list.length;
    recent.replaceChildren(
      ...list.map(song => {
        const row = document.createElement("div"),
          open = document.createElement("button"),
          heart = document.createElement("button");
        row.className = "music-recognize-song";
        open.type = heart.type = "button";
        open.className = "music-recognize-song-open";
        open.textContent = `${song.title} — ${song.artist}`;
        open.title = t("Search for this song");
        open.addEventListener("click", () => {
          menu.hidePopover?.();
          search(song);
        });
        heart.className = "music-icon-button music-recognize-like";
        heart.textContent = "♡";
        heart.title = heart.ariaLabel = t("Like this song");
        heart.hidden = !like;
        heart.addEventListener("click", async () => {
          heart.disabled = true;
          try {
            if (await like(song)) {
              heart.textContent = "♥";
              notify(t("Added to liked songs: {title}", { title: song.title }));
            } else notify(t("Could not find this song in the catalog."), true);
          } catch (error) {
            notify(errorText(error), true);
          } finally {
            heart.disabled = false;
          }
        });
        row.append(open, heart);
        return row;
      }),
    );
  }
  function search(song) {
    input.value = `${song.title} ${song.artist}`.slice(
      0,
      Number(input.maxLength) > 0 ? Number(input.maxLength) : 120,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
    form.requestSubmit();
  }
  let controller = null;
  const label = () => {
    button.title = button.ariaLabel = controller ? t("Stop listening") : t("Identify a song");
    text.textContent = controller ? t("Listening…") : t("Identify song");
    sources.microphone.name.textContent = t("With the microphone");
    sources.microphone.hint.textContent = t("A song playing in the room");
    sources.computer.name.textContent = t("This computer's sound");
    sources.computer.hint.textContent = t("A song in a browser, video or game");
    sources.file.name.textContent = t("From a file");
    sources.file.hint.textContent = t("An audio or video file on this computer");
    recentTitle.textContent = t("Recently identified");
  };
  label();
  onLanguageChange(label);
  // Ten seconds of sound from the chosen place, as signed 16-bit samples at 16 kHz; null when the person
  // closed the file picker.
  async function hear(source, signal) {
    if (source === "microphone") {
      notify(t("Listening… Hold the computer near the music."));
      const { samples, rate } = await record({ signal });
      if (quiet(samples))
        throw Object.assign(
          new Error(
            t(
              "The microphone heard only silence. Check that Deviload may use it in Windows privacy settings.",
            ),
          ),
          { advice: true },
        );
      return toInt16(resample(samples, rate));
    }
    if (source === "computer") {
      notify(t("Listening to this computer…"));
      const samples = samplesFromBase64(await invoke("music_capture_output", { seconds: 10 }));
      if (quietInt(samples))
        throw Object.assign(
          new Error(t("Nothing is playing on this computer. Start the song, then try again.")),
          {
            advice: true,
          },
        );
      return samples;
    }
    const encoded = await invoke("music_recognize_file");
    if (encoded == null) return null;
    notify(t("Recognizing…"));
    return samplesFromBase64(encoded);
  }
  async function listen(source = "microphone") {
    if (controller) return controller.abort();
    controller = new AbortController();
    const { signal } = controller;
    button.classList.add("is-listening");
    button.setAttribute("aria-pressed", "true");
    label();
    try {
      const samples = await hear(source, signal);
      if (signal.aborted) throw Object.assign(new Error(), { name: "AbortError" });
      if (!samples) return;
      notify(t("Recognizing…"));
      const signature = shazamSignature(samples);
      const song = await invoke("music_recognize", { uri: signature.uri, samplems: signature.samplems });
      if (signal.aborted) return;
      if (!song?.title)
        return notify(
          source === "microphone"
            ? t("No match. Try again closer to the music.")
            : t("No match for this sound."),
          true,
        );
      rememberSong(song, source, storage);
      notify(t("Found: {title} — {artist}", { title: song.title, artist: song.artist }));
      search(song);
    } catch (error) {
      if (error?.name === "AbortError") notify(t("Listening stopped."));
      else if (error?.advice) notify(error.message, true);
      else if (error?.name === "NotAllowedError" || error?.name === "NotFoundError")
        notify(t("No microphone is available. Allow Deviload to use it in Windows privacy settings."), true);
      else notify(errorText(error), true);
    } finally {
      controller = null;
      button.classList.remove("is-listening");
      button.removeAttribute("aria-pressed");
      label();
    }
  }
  return { button, listen, menu };
}
