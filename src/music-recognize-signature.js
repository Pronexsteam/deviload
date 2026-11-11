// An audio fingerprint in the format Shazam's recognition service reads: spectral peaks of 16 kHz mono audio,
// grouped into four frequency bands and packed into a small binary record. Written for Devil Music from the
// published description of the format; it reads samples only and keeps no audio.
export const SAMPLE_RATE = 16000;
const FRAME = 2048,
  HOP = 128,
  BINS = FRAME / 2 + 1,
  HISTORY = 256,
  FLOOR = 1 / 64;
const BANDS = [
  [250, 520],
  [520, 1450],
  [1450, 3500],
  [3500, 5500],
];
const NEIGHBORS = [-10, -7, -4, -3, 1, 2, 5, 8];
const EARLIER = [-53, -45, 165, 172, 179, 186, 193, 200, 214, 221, 228, 235, 242, 249];

// Hann window of 2050 points without its two zero ends.
const WINDOW = Float64Array.from(
  { length: FRAME },
  (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (n + 1)) / (FRAME + 1)),
);
const COS = Float64Array.from({ length: FRAME / 2 }, (_, k) => Math.cos((2 * Math.PI * k) / FRAME));
const SIN = Float64Array.from({ length: FRAME / 2 }, (_, k) => -Math.sin((2 * Math.PI * k) / FRAME));
const REVERSED = (() => {
  const bits = Math.log2(FRAME),
    table = new Uint16Array(FRAME);
  for (let i = 0; i < FRAME; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    table[i] = r;
  }
  return table;
})();

// Power spectrum of one windowed frame: iterative radix-2 FFT.
function power(frame, out) {
  const re = new Float64Array(FRAME),
    im = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i++) re[REVERSED[i]] = frame[i];
  for (let size = 2; size <= FRAME; size *= 2) {
    const half = size / 2,
      step = FRAME / size;
    for (let start = 0; start < FRAME; start += size)
      for (let k = 0; k < half; k++) {
        const c = COS[k * step],
          s = SIN[k * step],
          a = start + k,
          b = a + half,
          tr = re[b] * c - im[b] * s,
          ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
  }
  for (let k = 0; k < BINS; k++) out[k] = Math.max((re[k] * re[k] + im[k] * im[k]) / (1 << 17), 1e-10);
}

const ring = () => Array.from({ length: HISTORY }, () => new Float64Array(BINS));
const at = (position, offset) => (((position + offset) % HISTORY) + HISTORY) % HISTORY;
const level = value => Math.log(Math.max(FLOOR, value)) * 1477.3 + 6144;

/** Spectral peaks per band from signed 16-bit samples at 16 kHz. */
export function findPeaks(samples) {
  const recent = new Float64Array(FRAME),
    frame = new Float64Array(FRAME),
    spectra = ring(),
    spread = ring(),
    peaks = [[], [], [], []];
  let samplePosition = 0,
    spectrumPosition = 0,
    spreadPosition = 0,
    spreadCount = 0,
    count = 0;
  for (let offset = 0; offset + HOP <= samples.length; offset += HOP) {
    for (let i = 0; i < HOP; i++) recent[samplePosition + i] = samples[offset + i];
    samplePosition = (samplePosition + HOP) % FRAME;
    count += HOP;
    // Oldest sample first, through the window.
    for (let i = 0; i < FRAME; i++) frame[i] = WINDOW[i] * recent[(samplePosition + i) % FRAME];
    power(frame, spectra[spectrumPosition]);
    const latest = spectra[spectrumPosition];
    spectrumPosition = (spectrumPosition + 1) % HISTORY;

    // Each bin takes the loudest of itself and its two upper neighbours, and lends that to three earlier frames.
    const widened = Float64Array.from(latest);
    for (let bin = 0; bin < BINS; bin++) {
      if (bin < BINS - 2) widened[bin] = Math.max(widened[bin], widened[bin + 1], widened[bin + 2]);
      let loudest = widened[bin];
      for (const back of [1, 3, 6]) {
        const earlier = spread[at(spreadPosition, -back)];
        loudest = earlier[bin] = Math.max(earlier[bin], loudest);
      }
    }
    spread[spreadPosition].set(widened);
    spreadPosition = (spreadPosition + 1) % HISTORY;
    spreadCount++;
    if (spreadCount < 46) continue;

    // A peak 46 frames back must stand above its widened neighbourhood, in its own frame and around it.
    const candidate = spectra[at(spectrumPosition, -46)],
      around = spread[at(spreadPosition, -49)];
    for (let bin = 10; bin < 1015; bin++) {
      const value = candidate[bin];
      if (value < FLOOR || value < around[bin - 1]) continue;
      let ceiling = 0;
      for (const n of NEIGHBORS) ceiling = Math.max(ceiling, around[bin + n]);
      if (value <= ceiling) continue;
      for (const e of EARLIER) ceiling = Math.max(ceiling, spread[at(spreadPosition, e)][bin - 1]);
      if (value <= ceiling) continue;
      const magnitude = level(value),
        before = level(candidate[bin - 1]),
        after = level(candidate[bin + 1]),
        curvature = magnitude * 2 - before - after;
      if (!(curvature > 0)) continue;
      const corrected = bin * 64 + ((after - before) * 32) / curvature,
        hertz = (corrected * SAMPLE_RATE) / 2 / 1024 / 64,
        band = BANDS.findIndex(
          ([low, high], index) => hertz > low && (index === 3 ? hertz <= high : hertz < high),
        );
      if (band < 0) continue;
      peaks[band].push({
        pass: spreadCount - 46,
        magnitude: Math.trunc(magnitude),
        bin: Math.trunc(corrected),
      });
    }
  }
  return { peaks, samples: count };
}

const CRC = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The binary record: a 48-byte header, then each band's peaks as time steps, magnitudes and bins. */
export function encodeSignature({ peaks, samples }) {
  const parts = [];
  for (let band = 0; band < 4; band++) {
    if (!peaks[band].length) continue;
    const body = [];
    let pass = 0;
    for (const peak of peaks[band]) {
      if (peak.pass - pass >= 255) {
        body.push(
          0xff,
          peak.pass & 0xff,
          (peak.pass >>> 8) & 0xff,
          (peak.pass >>> 16) & 0xff,
          (peak.pass >>> 24) & 0xff,
        );
        pass = peak.pass;
      }
      body.push(
        peak.pass - pass,
        peak.magnitude & 0xff,
        peak.magnitude >>> 8,
        peak.bin & 0xff,
        peak.bin >>> 8,
      );
      pass = peak.pass;
    }
    const head = new DataView(new ArrayBuffer(8));
    head.setUint32(0, 0x60030040 + band, true);
    head.setUint32(4, body.length, true);
    parts.push(...new Uint8Array(head.buffer), ...body, ...new Array((4 - (body.length % 4)) % 4).fill(0));
  }
  const bytes = new Uint8Array(48 + 8 + parts.length),
    view = new DataView(bytes.buffer);
  const words = [
    0xcafe2580,
    0,
    parts.length + 8,
    0x94119c00,
    0,
    0,
    0,
    3 << 27,
    0,
    0,
    Math.trunc(samples + SAMPLE_RATE * 0.24),
    (15 << 19) + 0x40000,
  ];
  words.forEach((word, index) => view.setUint32(index * 4, word >>> 0, true));
  view.setUint32(48, 0x40000000, true);
  view.setUint32(52, parts.length + 8, true);
  bytes.set(parts, 56);
  view.setUint32(4, crc32(bytes.subarray(8)), true);
  return bytes;
}

const base64 = bytes => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

/** A recognition request body for signed 16-bit samples at 16 kHz. */
export function shazamSignature(samples) {
  const found = findPeaks(samples);
  return {
    uri: "data:audio/vnd.shazam.sig;base64," + base64(encodeSignature(found)),
    samplems: Math.trunc((found.samples / SAMPLE_RATE) * 1000),
    peaks: found.peaks.reduce((sum, band) => sum + band.length, 0),
  };
}

/** Float samples from Web Audio, -1..1, as signed 16-bit values. */
export function toInt16(floats) {
  return Int16Array.from(floats, value => Math.max(-32768, Math.min(32767, Math.round(value * 32767))));
}
