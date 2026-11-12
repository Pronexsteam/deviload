import { t } from "./i18n.js";
import {
  STORY,
  storyLayout,
  tokenLight,
  storyFade,
  storyType,
  restingWave,
  clockText,
} from "./music-lyric-story-model.js";

// A lyric story: a vertical video of the chosen lines with the song's own sound, the words lighting up as they
// are sung. It is drawn on a canvas and recorded live from a second, silent copy of the song, so what plays
// on the speakers is not touched.
const FONT = 'Inter,"Segoe UI",-apple-system,BlinkMacSystemFont,sans-serif';
const BARS = 36;
// The player's mark at the foot of every story.
const mark =
  typeof Image === "function" ? Object.assign(new Image(), { src: "assets/deviload-mark.svg" }) : null;

function coverInto(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight),
    sw = w / scale,
    sh = h / scale;
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}

// Everything that does not change from frame to frame, drawn once.
export function storyScene({ song, picture, style, tone, window }) {
  const { width: W, height: H } = STORY;
  const back = document.createElement("canvas");
  back.width = W;
  back.height = H;
  const ctx = back.getContext("2d", { willReadFrequently: true });
  if (style === "cover" && picture) {
    ctx.filter = "blur(90px) saturate(1.6) brightness(.5)";
    coverInto(ctx, picture, -220, -220, W + 440, H + 440);
    ctx.filter = "none";
  } else if (style !== "night") {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, tone);
    g.addColorStop(1, "#111219");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgb(0 0 0 / .3)";
    ctx.fillRect(0, 0, W, H);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#17181f");
    g.addColorStop(1, "#07080b");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  const shade = ctx.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, "rgb(0 0 0 / .1)");
  shade.addColorStop(0.45, "rgb(0 0 0 / .2)");
  shade.addColorStop(1, "rgb(0 0 0 / .62)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);
  // A fine grain, so the blur reads as a photograph rather than a flat gradient.
  const grain = ctx.getImageData(0, 0, W, H),
    data = grain.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (Math.random() - 0.5) * 9;
    data[i] += n;
    data[i + 1] += n;
    data[i + 2] += n;
  }
  ctx.putImageData(grain, 0, 0);
  const measure = (text, size) => {
    ctx.font = `800 ${size}px ${FONT}`;
    return ctx.measureText(text).width;
  };
  const layout = storyLayout(window.lines, { x: 96, y: 990, width: W - 192, height: 560 }, measure);
  return { back, picture, song, tone, window, layout, levels: Float32Array.from(restingWave(BARS)) };
}

const clip = (ctx, text, font, max) => {
  ctx.font = font;
  let value = String(text || "");
  while (value.length > 1 && ctx.measureText(value).width > max) value = value.slice(0, -2) + "…";
  return value;
};

// One frame at song time [time]. [spectrum] is the latest analyser reading; without it (the preview) the
// waveform breathes on its own. [fade] darkens the first and last moments, as the recording does.
export function paintStory(ctx, scene, time, { spectrum = null, fade = true } = {}) {
  const { width: W, height: H } = STORY,
    { window, layout, picture, song, tone, levels } = scene,
    span = Math.max(0.001, window.end - window.start),
    done = Math.max(0, Math.min(1, (time - window.start) / span));
  const rest = restingWave(BARS);
  for (let i = 0; i < BARS; i++) {
    let value;
    if (spectrum) {
      const from = Math.floor(2 + (i / BARS) ** 1.5 * (spectrum.length * 0.62));
      value = 0.1 + (spectrum[Math.min(spectrum.length - 1, from)] / 255) ** 1.6 * 0.85;
    } else value = rest[i] * (0.75 + 0.45 * Math.abs(Math.sin(time * 3.1 + i * 0.9)));
    levels[i] += (value - levels[i]) * (value > levels[i] ? 0.5 : 0.16);
  }
  const bass = Math.max(0, (levels[0] + levels[1] + levels[2]) / 3 - 0.3);
  ctx.save();
  ctx.textBaseline = "alphabetic";
  // A slow drift keeps the background alive.
  const zoom = 1.04 + done * 0.05;
  ctx.drawImage(scene.back, (W - W * zoom) / 2, (H - H * zoom) / 2 - done * 40, W * zoom, H * zoom);
  // The cover, breathing a little with the bass.
  const size = 560 * (1 + bass * 0.03),
    left = (W - size) / 2,
    top = 470 - size / 2;
  ctx.save();
  ctx.shadowColor = "rgb(0 0 0 / .5)";
  ctx.shadowBlur = 80;
  ctx.shadowOffsetY = 30;
  ctx.beginPath();
  ctx.roundRect(left, top, size, size, 44);
  ctx.fillStyle = "rgb(255 255 255 / .08)";
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(left, top, size, size, 44);
  ctx.clip();
  if (picture) coverInto(ctx, picture, left, top, size, size);
  else {
    const g = ctx.createLinearGradient(left, top, left + size, top + size);
    g.addColorStop(0, tone);
    g.addColorStop(1, "#1a1b24");
    ctx.fillStyle = g;
    ctx.fillRect(left, top, size, size);
  }
  ctx.restore();
  ctx.strokeStyle = "rgb(255 255 255 / .14)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(left, top, size, size, 44);
  ctx.stroke();
  // Names.
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  ctx.fillText(clip(ctx, song?.title, `760 54px ${FONT}`, W - 200), W / 2, 850);
  ctx.fillStyle = "rgb(255 255 255 / .62)";
  ctx.fillText(
    clip(ctx, (song?.artists || []).join(", ") || song?.subtitle, `500 36px ${FONT}`, W - 200),
    W / 2,
    906,
  );
  ctx.textAlign = "left";
  // The words: the line being sung fills word by word, sung lines rest half lit, lines to come wait dim.
  if (layout) {
    ctx.font = `800 ${layout.size}px ${FONT}`;
    for (const token of layout.tokens) {
      const line = window.lines[token.line],
        over = time > (Number.isFinite(line?.end) ? line.end : token.end) + 0.25,
        light = tokenLight(token, time);
      ctx.shadowBlur = 0;
      if (over) ctx.fillStyle = "rgb(255 255 255 / .5)";
      else if (light >= 1) {
        ctx.shadowColor = "rgb(0 0 0 / .3)";
        ctx.shadowBlur = 24;
        ctx.fillStyle = "#fff";
      } else if (light <= 0) ctx.fillStyle = "rgb(255 255 255 / .28)";
      else {
        const g = ctx.createLinearGradient(token.x, 0, token.x + token.width, 0);
        g.addColorStop(Math.max(0, light - 0.08), "#fff");
        g.addColorStop(Math.min(1, light + 0.08), "rgb(255 255 255 / .28)");
        ctx.fillStyle = g;
      }
      ctx.fillText(token.text, token.x, token.y);
    }
    ctx.shadowBlur = 0;
  }
  // A waveform that is also the progress: the part already played is lit.
  const barWidth = 14,
    inner = W - 192,
    step = (inner - barWidth) / (BARS - 1),
    middle = 1650,
    playedTo = 96 + inner * done;
  for (let i = 0; i < BARS; i++) {
    const x = 96 + i * step,
      half = 6 + levels[i] * 56;
    ctx.fillStyle = x + barWidth / 2 <= playedTo ? "#fff" : "rgb(255 255 255 / .26)";
    ctx.beginPath();
    ctx.roundRect(x, middle - half, barWidth, half * 2, barWidth / 2);
    ctx.fill();
  }
  ctx.font = `600 30px ${FONT}`;
  ctx.fillStyle = "rgb(255 255 255 / .6)";
  ctx.fillText(clockText(Math.max(window.start, Math.min(time, window.end))), 96, 1758);
  ctx.textAlign = "right";
  ctx.fillText(clockText(window.end), W - 96, 1758);
  // The player's name.
  ctx.textAlign = "left";
  ctx.font = `700 32px ${FONT}`;
  const name = "Devil Music",
    nameWidth = ctx.measureText(name).width,
    drawn = !!(mark?.complete && mark.naturalWidth),
    markWidth = drawn ? 40 : 18,
    from = (W - nameWidth - markWidth - 14) / 2;
  if (drawn) ctx.drawImage(mark, from, 1818, 40, 44);
  else {
    ctx.fillStyle = tone;
    ctx.beginPath();
    ctx.arc(from + 9, 1842, 9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgb(255 255 255 / .9)";
  ctx.fillText(name, from + markWidth + 14, 1853);
  // Fade in and out.
  const light = fade ? storyFade(time, window) : 1;
  if (light < 1) {
    ctx.fillStyle = `rgb(0 0 0 / ${1 - light})`;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

// Records [scene] from the song at [url]; resolves with the video, or null when cancelled.
export function recordStory({ canvas, scene, url, onProgress = () => {}, signal }) {
  return new Promise((resolve, reject) => {
    const type = storyType(value => globalThis.MediaRecorder?.isTypeSupported?.(value));
    if (!type || !url) {
      reject(Error(t("This device cannot record video.")));
      return;
    }
    const { start, end } = scene.window;
    const media = new Audio();
    media.crossOrigin = "anonymous";
    media.preload = "auto";
    const context = new AudioContext(),
      source = context.createMediaElementSource(media),
      gain = context.createGain(),
      analyser = context.createAnalyser(),
      output = context.createMediaStreamDestination();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(output);
    gain.connect(analyser);
    const spectrum = new Uint8Array(analyser.frequencyBinCount);
    const ctx = canvas.getContext("2d");
    let recorder = null,
      frame = 0,
      finished = false,
      timeout = 0;
    const chunks = [];
    function cleanup() {
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
      media.pause();
      media.removeAttribute("src");
      media.load();
      context.close().catch(() => {});
    }
    function fail(error) {
      if (finished) return;
      finished = true;
      try {
        if (recorder?.state === "recording") recorder.stop();
      } catch {}
      cleanup();
      reject(error);
    }
    function stop() {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(frame);
      paintStory(ctx, scene, end, { spectrum });
      // A last frame of black lets the recorder catch the fade before it stops.
      setTimeout(() => recorder.stop(), 120);
    }
    signal?.addEventListener("abort", () => {
      if (finished) return;
      finished = true;
      try {
        if (recorder?.state === "recording") recorder.stop();
      } catch {}
      cleanup();
      resolve(null);
    });
    function tick() {
      const time = media.currentTime;
      analyser.getByteFrequencyData(spectrum);
      gain.gain.setTargetAtTime(storyFade(time, scene.window), context.currentTime, 0.02);
      paintStory(ctx, scene, time, { spectrum });
      onProgress(Math.min(1, (time - start) / (end - start)), Math.max(0, end - time));
      if (time >= end || media.ended) stop();
      else frame = requestAnimationFrame(tick);
    }
    media.addEventListener("error", () => fail(Error(t("Could not load the song for the video."))));
    timeout = setTimeout(() => fail(Error(t("Could not load the song for the video."))), 20000);
    media.addEventListener(
      "loadedmetadata",
      () => {
        media.currentTime = start;
      },
      { once: true },
    );
    media.addEventListener(
      "seeked",
      async () => {
        if (finished) return;
        clearTimeout(timeout);
        try {
          await context.resume();
          const stream = new MediaStream([
            ...canvas.captureStream(STORY.fps).getVideoTracks(),
            ...output.stream.getAudioTracks(),
          ]);
          recorder = new MediaRecorder(stream, {
            mimeType: type,
            videoBitsPerSecond: 9_000_000,
            audioBitsPerSecond: 192_000,
          });
          recorder.ondataavailable = event => event.data.size && chunks.push(event.data);
          recorder.onstop = () => {
            cleanup();
            if (signal?.aborted) return;
            resolve(new Blob(chunks, { type: type.split(";")[0] }));
          };
          paintStory(ctx, scene, start, { spectrum });
          recorder.start(500);
          await media.play();
          frame = requestAnimationFrame(tick);
        } catch (error) {
          fail(error instanceof Error ? error : Error(t("This device cannot record video.")));
        }
      },
      { once: true },
    );
    media.src = url;
  });
}
