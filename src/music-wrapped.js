import { t, locale } from "./i18n.js";
import { artworkCandidates } from "./music-artwork.js";
import { recordStory } from "./music-lyric-story.js";
import { STORY, storyFade } from "./music-lyric-story-model.js";
import { wrappedSlides, slideAt, storyLength, countUp, SLIDE_SECONDS } from "./music-wrapped-model.js";

// Devil Wrapped: the year in music as a vertical story. Every frame is drawn on one canvas, so what plays in
// the window is exactly what the saved video shows, with the listener's top song as its sound.
const W = STORY.width,
  H = STORY.height,
  FONT = '"Segoe UI Variable Display", "Segoe UI", Inter, system-ui, sans-serif';
// Each slide has its own pair of colours; the background drifts from one to the next.
const PALETTE = [
  ["#e8284c", "#3b0a1f"],
  ["#7c3aed", "#140a2e"],
  ["#f97316", "#2a0e05"],
  ["#0ea5e9", "#04172a"],
  ["#db2777", "#2a0718"],
  ["#22c55e", "#04200f"],
  ["#e11d48", "#1f0610"],
  ["#a855f7", "#12071f"],
];
const ease = value => 1 - (1 - Math.min(1, Math.max(0, value))) ** 3;
const mix = (a, b, amount) => {
  const parse = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [parse(a), parse(b)];
  return `rgb(${x.map((value, i) => Math.round(value + (y[i] - value) * amount)).join(",")})`;
};

function fitText(ctx, text, maxWidth, size, weight = 800, min = 40) {
  let current = size;
  do {
    ctx.font = `${weight} ${current}px ${FONT}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    current -= 4;
  } while (current > min);
  return current;
}
function ellipsis(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(out + "…").width > maxWidth) out = out.slice(0, -1);
  return out.trimEnd() + "…";
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
function coverInto(ctx, img, x, y, size, radius) {
  ctx.save();
  roundRect(ctx, x, y, size, size, radius);
  ctx.clip();
  if (img) {
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.drawImage(
      img,
      (img.naturalWidth - side) / 2,
      (img.naturalHeight - side) / 2,
      side,
      side,
      x,
      y,
      size,
      size,
    );
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `700 ${size * 0.4}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("♪", x + size / 2, y + size / 2);
  }
  ctx.restore();
}

function background(ctx, index, progress, time, beat) {
  const [a1, b1] = PALETTE[index % PALETTE.length],
    [a2, b2] = PALETTE[(index + 1) % PALETTE.length],
    blend = Math.max(0, (progress - 0.88) / 0.12);
  const top = mix(a1, a2, blend),
    bottom = mix(b1, b2, blend);
  const gradient = ctx.createLinearGradient(0, 0, W * 0.4, H);
  gradient.addColorStop(0, top);
  gradient.addColorStop(0.55, bottom);
  gradient.addColorStop(1, "#05050a");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);
  // Soft glowing shapes that drift and swell with the music.
  for (let i = 0; i < 4; i++) {
    const angle = time * (0.18 + i * 0.07) + i * 1.7,
      x = W * (0.5 + Math.cos(angle) * 0.38),
      y = H * (0.3 + i * 0.16 + Math.sin(angle * 1.3) * 0.06),
      radius = W * (0.32 + i * 0.05) * (1 + beat * 0.12);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(
      0,
      i % 2 ? "rgba(255,255,255,0.10)" : `${top.replace("rgb", "rgba").replace(")", ",0.45)")}`,
    );
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
  }
}

function progressBars(ctx, slides, index, progress) {
  const gap = 10,
    width = (W - 120 - gap * (slides.length - 1)) / slides.length;
  slides.forEach((_, i) => {
    const x = 60 + i * (width + gap);
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    roundRect(ctx, x, 60, width, 8, 4);
    ctx.fill();
    const fill = i < index ? 1 : i === index ? progress : 0;
    if (fill > 0) {
      ctx.fillStyle = "#fff";
      roundRect(ctx, x, 60, width * fill, 8, 4);
      ctx.fill();
    }
  });
}

function eyebrow(ctx, text, y, appear) {
  ctx.globalAlpha = appear;
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.font = `700 46px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text.toUpperCase(), W / 2, y + (1 - appear) * 30);
  ctx.globalAlpha = 1;
}

function bigText(ctx, text, y, size, appear, color = "#fff") {
  ctx.globalAlpha = appear;
  ctx.fillStyle = color;
  fitText(ctx, text, W - 140, size);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, W / 2, y + (1 - appear) * 50);
  ctx.globalAlpha = 1;
}

function line(ctx, text, y, size, appear, alpha = 0.85, weight = 600) {
  ctx.globalAlpha = appear * alpha;
  ctx.fillStyle = "#fff";
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(ellipsis(ctx, text, W - 160), W / 2, y + (1 - appear) * 30);
  ctx.globalAlpha = 1;
}

const number = value => Number(value).toLocaleString(locale());
// "October" for a story that starts in October, and "October – December" for the months it covers.
const monthName = (index, form = "long") =>
  new Intl.DateTimeFormat(locale(), { month: form }).format(new Date(2026, index, 15));
const capital = text => text.charAt(0).toUpperCase() + text.slice(1);
// The month as it stands after "since": the form a date uses (the genitive in Russian), taken from a full date.
const monthGenitive = index =>
  new Intl.DateTimeFormat(locale(), { day: "numeric", month: "long" })
    .formatToParts(new Date(2026, index, 15))
    .find(part => part.type === "month")?.value || monthName(index);
function covered(since, form = "long") {
  if (since === null || since === undefined) return "";
  const now = new Date().getMonth(),
    last = now >= since ? now : 11;
  return last === since
    ? capital(monthName(since, form))
    : `${capital(monthName(since, form))} – ${monthName(last, form)}`;
}

function slide(ctx, data, progress, covers, time, beat) {
  const appear = step => ease((progress - step) / 0.18);
  switch (data.kind) {
    case "intro": {
      eyebrow(ctx, "Devil Music", 700, appear(0));
      bigText(ctx, "Wrapped", 900, 230, appear(0.08));
      ctx.globalAlpha = appear(0.18);
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 5;
      ctx.font = `900 ${300 * (1 + beat * 0.04)}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.strokeText(String(data.year), W / 2, 1250);
      ctx.globalAlpha = 1;
      line(ctx, data.since === null ? t("Your year in music") : covered(data.since), 1420, 54, appear(0.3));
      break;
    }
    case "minutes": {
      eyebrow(
        ctx,
        data.since === null
          ? t("This year you listened for")
          : t("Since {month} you listened for", { month: monthGenitive(data.since) }),
        640,
        appear(0),
      );
      bigText(ctx, number(countUp(data.minutes, progress)), 900, 260, appear(0.05));
      line(ctx, t("minutes"), 1000, 70, appear(0.1), 0.95, 700);
      line(ctx, t("{plays} listens", { plays: number(data.plays) }), 1220, 54, appear(0.45));
      if (data.days >= 1)
        line(
          ctx,
          t("That is about {days} days of music", { days: data.days.toLocaleString(locale()) }),
          1300,
          46,
          appear(0.55),
          0.7,
        );
      else if (data.minutes >= 60)
        line(
          ctx,
          t("That is about {hours} hours of music", { hours: Math.round(data.minutes / 60) }),
          1300,
          46,
          appear(0.55),
          0.7,
        );
      break;
    }
    case "artist": {
      eyebrow(ctx, t("Your top artist"), 470, appear(0));
      const size = 560,
        x = (W - size) / 2,
        y = 560 + (1 - appear(0.05)) * 60;
      ctx.save();
      ctx.globalAlpha = appear(0.05);
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = 60;
      coverInto(ctx, data.song ? covers.get(data.song.id) : null, x, y, size, size / 2);
      ctx.restore();
      bigText(ctx, data.name, 1340, 150, appear(0.2));
      line(ctx, t("{minutes} minutes together", { minutes: number(data.minutes) }), 1440, 52, appear(0.35));
      break;
    }
    case "songs":
    case "artists": {
      eyebrow(ctx, data.kind === "songs" ? t("Your top songs") : t("Your top artists"), 420, appear(0));
      const rows = data.kind === "songs" ? data.songs : data.artists,
        top = Math.max(1, ...rows.map(row => row.minutes || 0));
      rows.forEach((row, i) => {
        const shown = appear(0.08 + i * 0.07),
          y = 540 + i * 230 + (1 - shown) * 40;
        ctx.globalAlpha = shown;
        ctx.fillStyle = "#fff";
        ctx.font = `900 92px ${FONT}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), 80, y + 90);
        let left = 190;
        if (data.kind === "songs") {
          coverInto(ctx, covers.get(row.id), left, y, 180, 24);
          left += 210;
        }
        ctx.font = `800 58px ${FONT}`;
        ctx.fillText(
          ellipsis(ctx, row.title || row.name, W - left - 80),
          left,
          y + (data.kind === "songs" ? 62 : 70),
        );
        if (data.kind === "songs") {
          ctx.globalAlpha = shown * 0.7;
          ctx.font = `600 44px ${FONT}`;
          ctx.fillText(ellipsis(ctx, row.artist || "", W - left - 80), left, y + 128);
        } else {
          const width = (W - left - 80) * (row.minutes / top) * ease((progress - 0.15 - i * 0.07) / 0.4);
          ctx.globalAlpha = shown * 0.85;
          roundRect(ctx, left, y + 112, Math.max(8, width), 18, 9);
          ctx.fill();
          ctx.globalAlpha = shown * 0.7;
          ctx.font = `600 40px ${FONT}`;
          ctx.fillText(t("{minutes} min", { minutes: number(row.minutes) }), left, y + 170);
        }
        ctx.globalAlpha = 1;
      });
      break;
    }
    case "month": {
      eyebrow(ctx, t("Your biggest month"), 520, appear(0));
      const name = new Intl.DateTimeFormat(locale(), { month: "long" }).format(
        new Date(2026, data.index, 15),
      );
      bigText(ctx, name.charAt(0).toUpperCase() + name.slice(1), 720, 180, appear(0.06));
      line(
        ctx,
        t("{minutes} minutes of music", { minutes: number(countUp(data.minutes, progress)) }),
        820,
        52,
        appear(0.15),
      );
      const most = Math.max(1, ...data.months),
        width = (W - 200) / 12;
      data.months.forEach((seconds, i) => {
        const height = 600 * (seconds / most) * ease((progress - 0.2 - i * 0.02) / 0.35);
        ctx.fillStyle = i === data.index ? "#fff" : "rgba(255,255,255,0.35)";
        roundRect(ctx, 100 + i * width + 8, 1560 - height, width - 16, Math.max(6, height), 12);
        ctx.fill();
      });
      break;
    }
    case "likes": {
      eyebrow(ctx, t("Songs you loved"), 640, appear(0));
      ctx.globalAlpha = appear(0.05);
      ctx.fillStyle = "#fff";
      ctx.font = `400 ${260 * (1 + beat * 0.08)}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("♥", W / 2, 860);
      ctx.globalAlpha = 1;
      bigText(ctx, number(countUp(data.likes, progress)), 1200, 220, appear(0.12));
      line(ctx, t("songs liked this year and before"), 1300, 50, appear(0.25), 0.8);
      break;
    }
    case "summary": {
      const shown = appear(0);
      ctx.globalAlpha = shown;
      ctx.fillStyle = "rgba(10,10,18,0.55)";
      roundRect(ctx, 70, 220 + (1 - shown) * 60, W - 140, 1460, 56);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
      eyebrow(ctx, `Devil Wrapped ${data.year}`, 360, shown);
      if (data.since !== null) line(ctx, covered(data.since), 420, 38, shown, 0.65);
      line(ctx, t("Minutes listened"), 500, 44, appear(0.05), 0.7);
      bigText(ctx, number(data.minutes), 640, 150, appear(0.08));
      if (data.artist) {
        line(ctx, t("Top artist"), 760, 44, appear(0.12), 0.7);
        bigText(ctx, data.artist, 870, 96, appear(0.15));
      }
      line(ctx, t("Top songs"), 1010, 44, appear(0.2), 0.7);
      data.songs.forEach((song, i) => {
        const y = 1060 + i * 170,
          visible = appear(0.25 + i * 0.06);
        ctx.globalAlpha = visible;
        coverInto(ctx, covers.get(song.id), 150, y, 130, 20);
        ctx.fillStyle = "#fff";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.font = `800 50px ${FONT}`;
        ctx.fillText(ellipsis(ctx, `${i + 1}. ${song.title}`, W - 460), 310, y + 45);
        ctx.globalAlpha = visible * 0.7;
        ctx.font = `600 38px ${FONT}`;
        ctx.fillText(ellipsis(ctx, song.artist || "", W - 460), 310, y + 98);
        ctx.globalAlpha = 1;
      });
      line(ctx, "Deviload · Devil Music", 1620, 40, appear(0.4), 0.6, 700);
      break;
    }
  }
}

// One frame of the story at [time] seconds of the song; the story itself starts at scene.window.start.
export function paintWrapped(ctx, scene, time, { spectrum = null, fade = true } = {}) {
  const local = Math.max(0, time - scene.window.start),
    { index, progress } = slideAt(scene.slides, local);
  let beat = 0;
  if (spectrum?.length) {
    let sum = 0;
    for (let i = 1; i < 12; i++) sum += spectrum[i];
    beat = Math.min(1, sum / (11 * 255));
  } else beat = (Math.sin(local * 4.2) + 1) * 0.08;
  ctx.save();
  background(ctx, index, progress, local, beat);
  if (index >= 0) slide(ctx, scene.slides[index], progress, scene.covers, local, beat);
  progressBars(ctx, scene.slides, index, progress);
  // The video fades in and out with its sound.
  if (fade) {
    const light = storyFade(time, scene.window);
    if (light < 1) {
      ctx.fillStyle = `rgba(0,0,0,${1 - light})`;
      ctx.fillRect(0, 0, W, H);
    }
  }
  ctx.restore();
}

function loadCover(image) {
  const url = artworkCandidates(image, 512)[0];
  if (!url) return Promise.resolve(null);
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

const base64 = blob =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

export function createWrapped({ invoke, weekly, likes, findItem, play, getAudio, currentId }) {
  const dialog = document.createElement("dialog"),
    stage = document.createElement("div"),
    canvas = document.createElement("canvas"),
    bar = document.createElement("div"),
    previous = document.createElement("button"),
    pause = document.createElement("button"),
    next = document.createElement("button"),
    savePicture = document.createElement("button"),
    saveVideo = document.createElement("button"),
    close = document.createElement("button"),
    status = document.createElement("p");
  dialog.className = "music-wrapped-dialog";
  stage.className = "music-wrapped-stage";
  canvas.width = W;
  canvas.height = H;
  canvas.className = "music-wrapped-canvas";
  bar.className = "music-wrapped-bar";
  status.className = "music-wrapped-status";
  status.setAttribute("role", "status");
  close.className = "music-wrapped-close";
  close.textContent = "×";
  for (const button of [previous, pause, next, savePicture, saveVideo, close]) button.type = "button";
  previous.className = next.className = pause.className = "music-wrapped-step";
  savePicture.className = saveVideo.className = "outline small";
  previous.textContent = "‹";
  next.textContent = "›";
  bar.append(previous, pause, next, savePicture, saveVideo);
  stage.append(canvas, close);
  dialog.append(stage, bar, status);
  document.body.append(dialog);
  const ctx = canvas.getContext("2d");
  let scene = null,
    clock = 0,
    playing = true,
    last = 0,
    frame = 0,
    recording = null;
  function labels() {
    pause.textContent = playing ? "❚❚" : "▶";
    pause.setAttribute("aria-label", playing ? t("Pause") : t("Play"));
    previous.setAttribute("aria-label", t("Previous"));
    next.setAttribute("aria-label", t("Next"));
    close.setAttribute("aria-label", t("Close"));
    savePicture.textContent = t("Save picture");
    saveVideo.textContent = recording ? t("Stop recording") : t("Save video");
    dialog.setAttribute("aria-label", "Devil Wrapped");
  }
  function loop(now) {
    if (!dialog.open || recording) return;
    if (playing) clock = Math.min(storyLength(scene.slides), clock + (now - last) / 1000);
    last = now;
    paintWrapped(ctx, scene, scene.window.start + clock, { fade: false });
    if (clock >= storyLength(scene.slides)) {
      playing = false;
      labels();
    }
    frame = requestAnimationFrame(loop);
  }
  const jump = step => {
    const { index } = slideAt(scene.slides, clock);
    clock = Math.max(0, Math.min(scene.slides.length - 1, index + step)) * SLIDE_SECONDS;
    playing = true;
    labels();
  };
  previous.addEventListener("click", () => jump(-1));
  next.addEventListener("click", () => jump(1));
  pause.addEventListener("click", () => {
    if (clock >= storyLength(scene.slides)) clock = 0;
    playing = !playing;
    labels();
  });
  canvas.addEventListener("click", event => {
    const box = canvas.getBoundingClientRect();
    jump(event.clientX - box.left < box.width / 3 ? -1 : 1);
  });
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("keydown", event => {
    if (event.key === "ArrowLeft") jump(-1);
    if (event.key === "ArrowRight") jump(1);
  });
  dialog.addEventListener("close", () => {
    cancelAnimationFrame(frame);
    recording?.abort();
  });
  savePicture.addEventListener("click", async () => {
    const picture = document.createElement("canvas");
    picture.width = W;
    picture.height = H;
    const last = scene.slides.length - 1;
    paintWrapped(
      picture.getContext("2d"),
      scene,
      scene.window.start + last * SLIDE_SECONDS + SLIDE_SECONDS * 0.99,
      {
        fade: false,
      },
    );
    try {
      const blob = await new Promise(resolve => picture.toBlob(resolve, "image/png"));
      if (
        await invoke("save_lyric_card", { png: await base64(blob), name: `Devil Wrapped ${scene.year}.png` })
      )
        status.textContent = t("Picture saved.");
    } catch {
      status.textContent = t("Could not save the picture.");
    }
  });
  saveVideo.addEventListener("click", async () => {
    if (recording) {
      recording.abort();
      return;
    }
    const audio = getAudio(),
      url = audio?.currentSrc;
    if (!url || !scene.song || currentId() !== scene.song.id) {
      status.textContent = t("Play your top song first: it becomes the sound of the video.");
      if (scene.song) play(scene.song.id);
      return;
    }
    const length = storyLength(scene.slides),
      duration = Number.isFinite(audio.duration) ? audio.duration : length + 40,
      start = Math.max(0, Math.min(30, duration - length - 1));
    const control = new AbortController();
    recording = control;
    labels();
    status.textContent = t("Keep this window open while the video records.");
    try {
      const video = await recordStory({
        canvas,
        scene: { ...scene, window: { start, end: start + length } },
        url,
        signal: control.signal,
        paint: paintWrapped,
        onProgress: share =>
          (status.textContent = t("Recording… {percent}%", { percent: Math.round(share * 100) })),
      });
      if (!video) {
        status.textContent = t("Recording stopped.");
        return;
      }
      status.textContent = t("Saving the video…");
      const saved = await invoke("save_lyric_story", {
        video: await base64(video),
        name: `Devil Wrapped ${scene.year}`,
      });
      status.textContent = saved ? t("Video saved. Post it as a story or a short.") : "";
    } catch (error) {
      status.textContent = error?.message || t("Could not make the video.");
    } finally {
      recording = null;
      labels();
      if (dialog.open) {
        last = performance.now();
        frame = requestAnimationFrame(loop);
      }
    }
  });

  // The slides this year can show, without opening anything; empty when there is too little to tell.
  const slidesFor = year => {
    const recap = weekly.recap("year", year);
    return wrappedSlides({ recap, likes: likes(), year });
  };
  return {
    available: year => slidesFor(year).length > 0,
    async open(year) {
      const slides = slidesFor(year);
      if (!slides.length) return false;
      const songs = weekly.recap("year", year).songs;
      const covers = new Map();
      await Promise.all(
        songs.map(async song => {
          const item = findItem(song.id);
          if (item?.image) covers.set(song.id, await loadCover(item.image));
        }),
      );
      scene = {
        slides,
        covers,
        year,
        song: songs[0] || null,
        window: { start: 0, end: storyLength(slides) },
      };
      clock = 0;
      playing = true;
      status.textContent = "";
      labels();
      dialog.showModal();
      // The year starts with its top song, as the sound of the story.
      if (scene.song && currentId() !== scene.song.id) play(scene.song.id);
      last = performance.now();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(loop);
      return true;
    },
  };
}
