import { SAMPLE_RATE, shazamSignature, toInt16 } from "./music-recognize-signature.js";
import { resample, quiet } from "./music-recognize.js";

// Lyrics are timed on the studio recording, but YouTube often plays another upload of the song: a music video with a
// longer intro, a re-upload starting a second late. For every recording that actually plays, a few seconds of its
// sound are turned into a fingerprint here and recognised once; the answer says where in the studio recording that
// sound is, so the difference is how far this upload is shifted. It is kept per recording, so switching to another
// version of the song brings its own shift. Only the fingerprint leaves this computer, never the sound.
export const ALIGN_KEY = "deviload-recording-align-v1";
const KEEP = 400,
  MAX_AGE = 180 * 86400000,
  LISTEN = 8;

const plain = value =>
  String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s*[([].*?[)\]]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
// The service names the song it heard; the shift counts only if that is the song playing.
export function sameSong(found, title, artists) {
  const heard = plain(found?.title),
    wanted = plain(title);
  if (!heard || !wanted || !(heard.includes(wanted) || wanted.includes(heard))) return false;
  // A remix or a live take of the song runs on its own clock.
  const versions = value =>
    (
      String(value || "")
        .toLocaleLowerCase()
        .match(/\b(remix|live|acoustic|sped|slowed|edit|mix|version)\b/g) || []
    )
      .sort()
      .join();
  if (versions(found?.title) !== versions(title)) return false;
  const names = plain([].concat(artists || []).join(" ")).split(" "),
    singer = new Set(plain(found?.artist).split(" "));
  return !names.filter(Boolean).length || names.some(name => name.length > 1 && singer.has(name));
}

export function readAlignments(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(ALIGN_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

// Blocks of sound from a node of an audio graph until enough is heard, with the player's time where they began.
async function collect(context, source, clock, seconds, signal, watched) {
  const chunks = [];
  let length = 0,
    startedAt = NaN;
  const tap = context.createScriptProcessor(4096, 1, 1),
    mute = context.createGain();
  mute.gain.value = 0;
  const needed = Math.round(seconds * context.sampleRate);
  await new Promise((resolve, reject) => {
    const stop = () => reject(Object.assign(new Error(), { name: "AbortError" }));
    if (signal?.aborted) return stop();
    signal?.addEventListener("abort", stop, { once: true });
    // A jump or a pause in the middle would join two places of the song into one fingerprint.
    for (const name of ["seeking", "pause", "emptied"]) watched.addEventListener(name, stop, { once: true });
    tap.onaudioprocess = event => {
      const data = event.inputBuffer.getChannelData(0);
      // The first block ends where the player is now; it began one block earlier.
      if (!chunks.length) startedAt = clock() - data.length / context.sampleRate;
      chunks.push(Float32Array.from(data));
      length += data.length;
      if (length >= needed) resolve();
    };
    source.connect(tap);
    tap.connect(mute);
    mute.connect(context.destination);
  });
  const all = new Float32Array(length);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  return { samples: all, rate: context.sampleRate, startedAt };
}

// A few seconds of what an audio element plays, at 16 kHz, with the element's time where they began.
export async function captureElement(
  audio,
  seconds = LISTEN,
  { signal, Context = globalThis.AudioContext } = {},
) {
  const stream = audio.captureStream?.();
  // Never shown: a player that cannot be listened to only leaves the lyrics unmeasured.
  if (!stream?.getAudioTracks().length) throw Object.assign(new Error(), { name: "NotSupportedError" });
  const context = new Context({ sampleRate: SAMPLE_RATE });
  try {
    const source = context.createMediaStreamSource(stream);
    return await collect(context, source, () => audio.currentTime, seconds, signal, audio);
  } finally {
    for (const track of stream.getTracks()) track.stop();
    context.close().catch(() => {});
  }
}

// A few seconds of a recording nobody is listening to (a music video's own sound), played into the audio graph
// only, so nothing reaches the speakers.
export async function captureAddress(
  address,
  seconds = LISTEN,
  { signal, Context = globalThis.AudioContext, Player = globalThis.Audio } = {},
) {
  const node = new Player();
  node.crossOrigin = "anonymous";
  node.preload = "auto";
  const context = new Context({ sampleRate: SAMPLE_RATE });
  try {
    await new Promise((resolve, reject) => {
      node.addEventListener("loadedmetadata", resolve, { once: true });
      node.addEventListener(
        "error",
        () => reject(Object.assign(new Error(), { name: "NotSupportedError" })),
        {
          once: true,
        },
      );
      node.src = address;
    });
    // A third of the way in: past any intro, where the song itself plays.
    node.currentTime = Math.min(60, Math.max(0, (node.duration || 90) * 0.3));
    await new Promise(resolve => node.addEventListener("seeked", resolve, { once: true }));
    const source = context.createMediaElementSource(node),
      heard = collect(context, source, () => node.currentTime, seconds, signal, node);
    await node.play();
    return await heard;
  } finally {
    node.pause();
    node.removeAttribute("src");
    node.load?.();
    context.close().catch(() => {});
  }
}

export function createRecordingAlign({
  invoke,
  storage = globalThis.localStorage,
  capture = captureElement,
  captureFrom = captureAddress,
  now = Date.now,
}) {
  let table = readAlignments(storage);
  const running = new Map();
  const save = () => {
    const keys = Object.keys(table);
    if (keys.length > KEEP)
      keys
        .sort((a, b) => table[a].at - table[b].at)
        .slice(0, keys.length - KEEP)
        .forEach(key => delete table[key]);
    try {
      storage?.setItem(ALIGN_KEY, JSON.stringify(table));
    } catch {
      /* Kept for this session only. */
    }
  };
  const fresh = key => {
    const row = table[key];
    // A recording the service did not know is asked about again after a week.
    const age = row && Number.isFinite(row.shift) ? MAX_AGE : 7 * 86400000;
    return row && typeof row.at === "number" && now() - row.at < age ? row : null;
  };
  return {
    // Seconds to add to the player's time to reach the studio recording's time; 0 until it is known.
    shift(key) {
      const row = key && fresh(key);
      return row && Number.isFinite(row.shift) ? row.shift : 0;
    },
    known: key => !!(key && fresh(key)),
    // The measured shift, or null when the recording was not measured or the service did not know it.
    value(key) {
      const row = key && fresh(key);
      return row && Number.isFinite(row.shift) ? row.shift : null;
    },
    // Listens once per recording. A recording the service did not know is not asked about again for a while.
    // From the player that plays it (audio), or from its address when it is not played aloud (address).
    measure(key, { audio, address, title, artists, signal }) {
      if (!key || fresh(key) || running.has(key)) return running.get(key) || Promise.resolve(this.shift(key));
      const task = (async () => {
        const { samples, rate, startedAt } = address
          ? await captureFrom(address, LISTEN, { signal })
          : await capture(audio, LISTEN, { signal });
        if (!Number.isFinite(startedAt) || quiet(samples)) return 0;
        const signature = shazamSignature(toInt16(resample(samples, rate)));
        const found = await invoke("music_recognize", { uri: signature.uri, samplems: signature.samplems });
        const usable =
          found &&
          Number.isFinite(found.offset) &&
          Math.abs(found.skew || 0) < 0.01 &&
          sameSong(found, title, artists);
        const shift = usable ? Math.round((found.offset - startedAt) * 100) / 100 : NaN;
        table[key] = { shift: Math.abs(shift) <= 90 ? shift : null, at: now() };
        save();
        return this.shift(key);
      })()
        .catch(() => 0)
        .finally(() => running.delete(key));
      running.set(key, task);
      return task;
    },
  };
}
