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

export function wireMusicRecognize({ invoke, form, input, notify = () => {}, record = recordSamples }) {
  const button = document.createElement("button"),
    icon = document.createElement("span");
  button.type = "button";
  button.className = "music-recognize";
  icon.className = "icon";
  icon.dataset.icon = "microphone";
  icon.setAttribute("aria-hidden", "true");
  button.append(icon);
  form.insertBefore(button, form.querySelector(".music-search-submit"));
  let controller = null;
  const label = () => {
    button.title = button.ariaLabel = controller ? t("Stop listening") : t("Recognize a song playing nearby");
  };
  label();
  onLanguageChange(label);
  async function listen() {
    if (controller) return controller.abort();
    controller = new AbortController();
    const { signal } = controller;
    button.classList.add("is-listening");
    button.setAttribute("aria-pressed", "true");
    label();
    try {
      notify(t("Listening… Hold the computer near the music."));
      const { samples, rate } = await record({ signal });
      if (quiet(samples))
        return notify(
          t("The microphone heard only silence. Check that Deviload may use it in Windows privacy settings."),
          true,
        );
      notify(t("Recognizing…"));
      const signature = shazamSignature(toInt16(resample(samples, rate)));
      const song = await invoke("music_recognize", { uri: signature.uri, samplems: signature.samplems });
      if (signal.aborted) return;
      if (!song?.title) return notify(t("No match. Try again closer to the music."), true);
      notify(t("Found: {title} — {artist}", { title: song.title, artist: song.artist }));
      input.value = `${song.title} ${song.artist}`.slice(
        0,
        Number(input.maxLength) > 0 ? Number(input.maxLength) : 120,
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
      form.requestSubmit();
    } catch (error) {
      if (error?.name === "AbortError") notify(t("Listening stopped."));
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
  button.addEventListener("click", listen);
  return { button, listen };
}
