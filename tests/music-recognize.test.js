import test from "node:test";
import assert from "node:assert/strict";
import { findPeaks, encodeSignature, crc32, shazamSignature, toInt16, SAMPLE_RATE } from "../src/music-recognize-signature.js";

const element = tag => {
  const classes = new Set();
  const node = { tag, children: [], handlers: {}, dataset: {}, attributes: {}, value: "", maxLength: 120 };
  node.classList = { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) };
  node.append = (...items) => node.children.push(...items);
  node.insertBefore = item => node.children.push(item);
  node.querySelector = () => null;
  node.addEventListener = (name, fn) => (node.handlers[name] = fn);
  node.setAttribute = (k, v) => (node.attributes[k] = v);
  node.removeAttribute = k => delete node.attributes[k];
  node.dispatchEvent = () => {};
  node.after = item => (node.next = item);
  return node;
};
globalThis.requestAnimationFrame ??= fn => fn();
globalThis.document ??= { documentElement: { lang: "en" }, createElement: element };
const { wireMusicRecognize, resample, quiet } = await import("../src/music-recognize.js");
const { t } = await import("../src/i18n.js");

// A few notes in different bands, with a little noise so every frame has a spectrum.
function music(seconds) {
  const out = new Float32Array(seconds * SAMPLE_RATE);
  let seed = 7;
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const time = i / SAMPLE_RATE,
      note = Math.floor(time * 4) % 4;
    out[i] = 0.3 * Math.sin(2 * Math.PI * [330, 880, 2200, 4400][note] * time) + 0.02 * (seed / 2147483648 - 0.5);
  }
  return out;
}

test("peaks land in the band of the note that was playing", () => {
  const { peaks, samples } = findPeaks(toInt16(music(4)));
  assert.equal(samples, Math.floor((4 * SAMPLE_RATE) / 128) * 128);
  for (const band of peaks) assert.ok(band.length > 0);
  for (const band of peaks)
    for (let i = 1; i < band.length; i++) assert.ok(band[i].pass >= band[i - 1].pass, "peaks stay in time order");
  // 330 Hz sits in the first band: its corrected bin is near 330 / (8000 / 1024 / 64)… within a few percent.
  const expected = 330 / (SAMPLE_RATE / 2 / 1024 / 64);
  assert.ok(peaks[0].some(peak => Math.abs(peak.bin - expected) / expected < 0.03));
});

test("silence gives no peaks and a valid empty record", () => {
  const { peaks } = findPeaks(new Int16Array(SAMPLE_RATE * 2));
  assert.equal(peaks.flat().length, 0);
});

test("the binary record carries its header, sizes and checksum", () => {
  const found = findPeaks(toInt16(music(5)));
  const bytes = encodeSignature(found),
    view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(0, true), 0xcafe2580);
  assert.equal(view.getUint32(12, true), 0x94119c00);
  assert.equal(view.getUint32(28, true), 3 << 27);
  assert.equal(view.getUint32(40, true), found.samples + 3840);
  assert.equal(view.getUint32(44, true), (15 << 19) + 0x40000);
  assert.equal(view.getUint32(48, true), 0x40000000);
  assert.equal(view.getUint32(8, true), bytes.length - 48);
  assert.equal(view.getUint32(52, true), bytes.length - 48);
  assert.equal(view.getUint32(4, true), crc32(bytes.subarray(8)));
  // Bands follow in order, each padded to four bytes.
  let at = 56,
    last = -1;
  while (at < bytes.length) {
    const band = view.getUint32(at, true) - 0x60030040,
      size = view.getUint32(at + 4, true);
    assert.ok(band > last && band < 4);
    last = band;
    at += 8 + size + ((4 - (size % 4)) % 4);
  }
  assert.equal(at, bytes.length);
});

test("long gaps between peaks are written as an absolute time", () => {
  const bytes = encodeSignature({ peaks: [[{ pass: 3, magnitude: 1000, bin: 4000 }, { pass: 600, magnitude: 1100, bin: 4100 }], [], [], []], samples: 128 });
  const body = [...bytes.subarray(64)];
  assert.deepEqual(body.slice(0, 5), [3, 1000 & 255, 1000 >> 8, 4000 & 255, 4000 >> 8]);
  assert.deepEqual(body.slice(5, 10), [0xff, 600 & 255, 600 >> 8, 0, 0]);
  assert.equal(body[10], 0);
});

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("the request body is a data URI with the duration in milliseconds", () => {
  const signature = shazamSignature(toInt16(music(3)));
  assert.match(signature.uri, /^data:audio\/vnd\.shazam\.sig;base64,[A-Za-z0-9+/]+=*$/);
  assert.equal(signature.samplems, Math.trunc(((Math.floor((3 * SAMPLE_RATE) / 128) * 128) / SAMPLE_RATE) * 1000));
});

test("microphone audio at another rate is brought to 16 kHz, and silence is noticed", () => {
  const input = Float32Array.from({ length: 48000 }, (_, i) => Math.sin(i / 10));
  assert.equal(resample(input, 48000).length, 16000);
  assert.equal(resample(input, 16000), input);
  assert.ok(quiet(new Float32Array(1000)));
  assert.ok(!quiet(input));
});

test("the button records, sends only the fingerprint and searches for the song found", async () => {
  const form = element("form"),
    input = element("input");
  let submitted = 0;
  form.requestSubmit = () => submitted++;
  const calls = [],
    notes = [];
  const invoke = async (command, args) => {
    calls.push([command, Object.keys(args)]);
    return { title: "Thunderstruck", artist: "AC/DC" };
  };
  const { listen } = wireMusicRecognize({ invoke, form, input, notify: message => notes.push(message), record: async () => ({ samples: music(4), rate: SAMPLE_RATE }) });
  await listen();
  assert.deepEqual(calls, [["music_recognize", ["uri", "samplems"]]]);
  assert.equal(input.value, "Thunderstruck AC/DC");
  assert.equal(submitted, 1);
  assert.equal(notes.at(-1), t("Found: {title} — {artist}", { title: "Thunderstruck", artist: "AC/DC" }));
});

test("silence and refusals end with advice instead of a request", async () => {
  const form = element("form"),
    input = element("input");
  form.requestSubmit = () => assert.fail("no search without a song");
  const calls = [],
    notes = [];
  const invoke = async command => (calls.push(command), null);
  const silent = wireMusicRecognize({ invoke, form, input, notify: (m, e) => notes.push([m, e]), record: async () => ({ samples: new Float32Array(SAMPLE_RATE), rate: SAMPLE_RATE }) });
  await silent.listen();
  assert.equal(calls.length, 0);
  assert.equal(notes.at(-1)[1], true);
  const refused = wireMusicRecognize({ invoke, form, input, notify: (m, e) => notes.push([m, e]), record: async () => { throw Object.assign(Error("denied"), { name: "NotAllowedError" }); } });
  await refused.listen();
  assert.equal(notes.at(-1)[0], t("No microphone is available. Allow Deviload to use it in Windows privacy settings."));
  const nothing = wireMusicRecognize({ invoke, form, input, notify: (m, e) => notes.push([m, e]), record: async () => ({ samples: music(3), rate: SAMPLE_RATE }) });
  await nothing.listen();
  assert.equal(notes.at(-1)[0], t("No match. Try again closer to the music."));
});
