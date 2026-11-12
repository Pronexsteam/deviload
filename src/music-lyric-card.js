import { t, onLanguageChange } from "./i18n.js";
import { artworkCandidates } from "./music-artwork.js";
import { CARD, GAP, startingPick, togglePick, fitRows, cardFileName } from "./music-lyric-card-model.js";
import { STORY, storyWindow, storyFileName, clockText } from "./music-lyric-story-model.js";
import { storyScene, paintStory, recordStory } from "./music-lyric-story.js";

// "Share a line": a picture of one to four sung lines with the song's cover, to copy or save.
// It opens from the lyrics tools, or from a right click on a line.
const FONT = 'Inter,"Segoe UI",-apple-system,BlinkMacSystemFont,sans-serif';
const STYLES = [
  ["cover", "Cover"],
  ["tint", "Colour"],
  ["night", "Night"],
];

export function createLyricCard({ invoke, button, lyrics, getSong, getAudio = () => null }) {
  const make = (tag, cls = "", text = null) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };
  const dialog = make("dialog", "music-lyric-card-dialog");
  dialog.setAttribute("aria-labelledby", "music-lyric-card-title");
  const head = make("header", "music-lyric-card-head"),
    title = make("h2");
  title.id = "music-lyric-card-title";
  const close = make("button", "music-lyric-card-close");
  close.type = "button";
  close.addEventListener("click", () => dialog.close());
  head.append(title, close);
  const canvas = make("canvas", "music-lyric-card-preview");
  canvas.width = CARD.width;
  canvas.height = CARD.height;
  canvas.setAttribute("role", "img");
  // Picture or video: the same lines and look, as a still card or a short story with the song's sound.
  const formats = make("div", "music-lyric-card-styles music-lyric-card-formats");
  formats.setAttribute("role", "radiogroup");
  const glyph = name => {
    const node = make("span", "icon");
    node.dataset.icon = name;
    node.setAttribute("aria-hidden", "true");
    return node;
  };
  const formatButtons = ["picture", "video"].map(value => {
    const node = make("button", "music-lyric-card-style");
    node.type = "button";
    node.dataset.format = value;
    node.setAttribute("role", "radio");
    node.append(glyph(value === "video" ? "video" : "image"), make("span"));
    node.addEventListener("click", () => {
      if (format === value || recording) return;
      format = value;
      syncFormat();
    });
    formats.append(node);
    return node;
  });
  const side = make("div", "music-lyric-card-side"),
    styleLabel = make("p", "music-lyric-card-label"),
    styles = make("div", "music-lyric-card-looks");
  styles.setAttribute("role", "radiogroup");
  // The lines: a heading with how many are chosen, then the song's lines, each with its place and time.
  const linesHead = make("div", "music-lyric-card-lines-head"),
    linesLabel = make("p", "music-lyric-card-label"),
    linesCount = make("span", "music-lyric-card-count"),
    list = make("div", "music-lyric-card-lines");
  linesHead.append(linesLabel, linesCount);
  const actions = make("div", "music-lyric-card-actions"),
    copy = make("button", "music-lyric-card-copy"),
    save = make("button", "music-lyric-card-save"),
    status = make("p", "music-lyric-card-status");
  copy.type = save.type = "button";
  copy.append(glyph("copy"), make("span"));
  save.append(glyph("download-simple"), make("span"));
  status.setAttribute("role", "status");
  actions.append(save, copy);
  const section = (...nodes) => {
    const node = make("section", "music-lyric-card-section");
    node.append(...nodes);
    return node;
  };
  const linesSection = section(linesHead, list);
  linesSection.classList.add("is-lines");
  side.append(formats, section(styleLabel, styles), linesSection, section(actions, status));
  // The preview stage: while a video records, a REC mark and a progress line sit on the preview itself.
  const stage = make("div", "music-lyric-card-stage"),
    rec = make("span", "music-lyric-card-rec"),
    recTime = make("span", "music-lyric-card-rec-time"),
    meter = make("span", "music-lyric-card-meter");
  meter.append(make("span"));
  rec.append(make("i"), recTime, meter);
  stage.append(canvas, rec);
  const body = make("div", "music-lyric-card-body");
  body.append(stage, side);
  dialog.append(head, body);
  document.body.append(dialog);

  let snapshot = { lines: [], active: -1 },
    pick = [],
    style = "cover",
    song = null,
    art = null,
    artFor = "",
    drawing = 0,
    format = "picture",
    recording = null,
    preview = 0,
    timed = null;
  // Each look is a small swatch of itself: the blurred cover, the colour, or night.
  const styleButtons = STYLES.map(([value]) => {
    const node = make("button", "music-lyric-card-look");
    node.type = "button";
    node.dataset.style = value;
    node.setAttribute("role", "radio");
    node.append(make("span", "music-lyric-card-swatch"), make("span", "music-lyric-card-look-name"));
    node.addEventListener("click", () => {
      if (recording) return;
      style = value;
      syncStyles();
      void draw();
    });
    styles.append(node);
    return node;
  });
  function syncStyles() {
    for (const node of styleButtons) node.setAttribute("aria-checked", String(node.dataset.style === style));
  }

  function renderList() {
    list.replaceChildren(
      ...snapshot.lines.map((text, index) => {
        const row = make("button", "music-lyric-card-line");
        row.type = "button";
        const at = timed?.lines?.[index]?.at;
        row.append(
          make("span", "music-lyric-card-mark"),
          make("span", "music-lyric-card-line-text", text || "♪"),
          make("span", "music-lyric-card-time", Number.isFinite(at) ? clockText(at) : ""),
        );
        row.disabled = !text.trim();
        row.hidden = !text.trim();
        row.setAttribute("role", "checkbox");
        row.setAttribute("aria-checked", String(pick.includes(index)));
        row.addEventListener("click", () => {
          if (recording) return;
          pick = togglePick(pick, index, snapshot.lines);
          syncList();
          void draw();
        });
        return row;
      }),
    );
    syncList();
    requestAnimationFrame(() => list.children[pick[0]]?.scrollIntoView({ block: "center" }));
  }
  function syncList() {
    [...list.children].forEach((row, index) => {
      const place = pick.indexOf(index);
      row.setAttribute("aria-checked", String(place >= 0));
      row.firstElementChild.textContent = place >= 0 ? String(place + 1) : "";
    });
    linesCount.textContent = `${pick.length} / ${CARD.maxLines}`;
  }

  // The cover is loaded with CORS, so the finished picture can still be copied and saved.
  function loadArt(image) {
    if (image === artFor) return Promise.resolve(art);
    artFor = image;
    art = null;
    const url = artworkCandidates(image, 1024)[0];
    if (!url) return Promise.resolve(null);
    return new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onload = () => {
        if (artFor === image) art = img;
        resolve(art);
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }
  const accent = () => {
    const node = document.querySelector(".music-lyrics-content");
    const value = node && getComputedStyle(node).getPropertyValue("--lyric-aura").trim();
    return value || "#9ab4ff";
  };
  function coverInto(ctx, img, x, y, w, h) {
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight),
      sw = w / scale,
      sh = h / scale;
    ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
  }

  function syncFormat() {
    for (const node of formatButtons)
      node.setAttribute("aria-checked", String(node.dataset.format === format));
    const video = format === "video";
    canvas.width = video ? STORY.width : CARD.width;
    canvas.height = video ? STORY.height : CARD.height;
    canvas.classList.toggle("is-story", video);
    copy.hidden = video;
    save.disabled = false;
    labels();
    status.textContent = "";
    void draw();
  }
  // The stretch of the song the video covers, from the lyrics' own timing.
  // The timing taken when the window opened belongs to its song, even if the player has moved on since.
  const sameSong = () => !!song && getSong()?.id === song.id;
  const storySpan = () => storyWindow(timed, pick, sameSong() ? getAudio()?.duration : Infinity);
  async function drawStory(token) {
    const picture = await loadArt(song?.image || "");
    if (token !== drawing) return;
    await document.fonts?.ready;
    if (token !== drawing || recording) return;
    const span = storySpan(),
      ctx = canvas.getContext("2d");
    if (!span) {
      ctx.fillStyle = "#101117";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      status.textContent = t("A video needs lyrics with timing.");
      save.disabled = true;
      return;
    }
    save.disabled = false;
    status.textContent = t("{seconds} s · vertical 9:16 · with the song's sound", {
      seconds: Math.round(span.end - span.start),
    });
    // The preview plays the video silently on a loop, so the look can be judged before recording.
    const scene = storyScene({ song, picture, style, tone: accent(), window: span }),
      length = span.end - span.start,
      began = performance.now();
    let last = 0;
    const loop = now => {
      if (token !== drawing || recording || !dialog.open) return;
      preview = requestAnimationFrame(loop);
      if (now - last < 33) return;
      last = now;
      const time = span.start + (((now - began) / 1000) % (length + 1.2));
      paintStory(ctx, scene, Math.min(time, span.end), { fade: false });
    };
    paintStory(ctx, scene, span.start, { fade: false });
    preview = requestAnimationFrame(loop);
  }
  async function draw(withArt = true) {
    cancelAnimationFrame(preview);
    if (format === "video") return drawStory(++drawing);
    const token = ++drawing;
    const picture = withArt ? await loadArt(song?.image || "") : null;
    if (token !== drawing) return;
    await document.fonts?.ready;
    if (token !== drawing) return;
    const ctx = canvas.getContext("2d"),
      { width: W, height: H, pad } = CARD,
      tone = accent();
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    // Background.
    if (style === "cover" && picture) {
      ctx.filter = "blur(80px) saturate(1.5) brightness(.5)";
      coverInto(ctx, picture, -160, -160, W + 320, H + 320);
      ctx.filter = "none";
    } else if (style === "tint" || style === "cover") {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, tone);
      g.addColorStop(1, "#14151c");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "rgb(0 0 0 / .28)";
      ctx.fillRect(0, 0, W, H);
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#16171f");
      g.addColorStop(1, "#08090c");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    const shade = ctx.createLinearGradient(0, 0, 0, H);
    shade.addColorStop(0, "rgb(0 0 0 / .1)");
    shade.addColorStop(1, "rgb(0 0 0 / .35)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, W, H);
    // The song: cover and names.
    const size = 148,
      top = pad;
    if (picture) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(pad, top, size, size, 22);
      ctx.clip();
      coverInto(ctx, picture, pad, top, size, size);
      ctx.restore();
    } else {
      ctx.fillStyle = "rgb(255 255 255 / .12)";
      ctx.beginPath();
      ctx.roundRect(pad, top, size, size, 22);
      ctx.fill();
    }
    const nameX = pad + size + 32,
      nameWidth = W - nameX - pad;
    ctx.textBaseline = "alphabetic";
    const clip = (text, font, max) => {
      ctx.font = font;
      let value = String(text || "");
      while (value.length > 1 && ctx.measureText(value).width > max) value = value.slice(0, -2) + "…";
      return value;
    };
    ctx.fillStyle = "#fff";
    ctx.fillText(clip(song?.title, `700 46px ${FONT}`, nameWidth), nameX, top + 64);
    ctx.fillStyle = "rgb(255 255 255 / .72)";
    ctx.fillText(
      clip((song?.artists || []).join(", ") || song?.subtitle, `500 34px ${FONT}`, nameWidth),
      nameX,
      top + 114,
    );
    // The lines, as large as they fit.
    const texts = pick.map(index => snapshot.lines[index]).filter(Boolean),
      box = { width: W - pad * 2, height: H - top - size - pad - 200 };
    const measureAt = (text, px) => {
      ctx.font = `800 ${px}px ${FONT}`;
      return ctx.measureText(text).width;
    };
    const { size: px, rows } = fitRows(texts, box, measureAt),
      line = px * 1.18;
    const tall = rows.reduce((sum, row) => sum + (row === null ? GAP : 1), 0) * line;
    let y = top + size + 80 + (box.height - tall) / 2 + px;
    ctx.font = `800 ${px}px ${FONT}`;
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "rgb(0 0 0 / .35)";
    ctx.shadowBlur = 24;
    for (const row of rows) {
      if (row === null) {
        y += line * GAP;
        continue;
      }
      ctx.fillText(row, pad, y);
      y += line;
    }
    ctx.shadowBlur = 0;
    // Brand.
    ctx.fillStyle = tone;
    ctx.beginPath();
    ctx.arc(pad + 10, H - pad + 2, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `700 30px ${FONT}`;
    ctx.fillStyle = "rgb(255 255 255 / .85)";
    ctx.fillText("Devil Music", pad + 34, H - pad + 13);
    ctx.restore();
    canvas.setAttribute("aria-label", texts.join(" / "));
  }

  // A cover that will not travel (no CORS) is left out instead of failing the whole picture.
  async function blob() {
    const take = () =>
      new Promise((resolve, reject) => {
        try {
          canvas.toBlob(value => (value ? resolve(value) : reject(new TypeError())), "image/png");
        } catch (error) {
          reject(error);
        }
      });
    try {
      return await take();
    } catch {
      await draw(false);
      return take();
    }
  }
  const base64 = png =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = reject;
      reader.readAsDataURL(png);
    });
  copy.addEventListener("click", async () => {
    try {
      await invoke("copy_lyric_card", { png: await base64(await blob()) });
      status.textContent = t("Copied. Paste it into a chat or a story.");
    } catch {
      status.textContent = t("Could not copy the picture. Save it instead.");
    }
  });
  // Recording plays the stretch once, silently, while the preview shows the video being made.
  const recordingProgress = (share, left) => {
    recTime.textContent = t("Recording · {seconds} s left", { seconds: Math.ceil(left) });
    meter.style.setProperty("--done", `${Math.round(share * 1000) / 10}%`);
  };
  async function recordVideo() {
    if (recording) {
      recording.abort();
      return;
    }
    const span = storySpan(),
      url = getAudio()?.currentSrc;
    if (!span) return;
    // The sound comes from the player, so it must still be playing this song.
    if (!sameSong()) {
      status.textContent = t("The song has changed. Open the video again from its lyrics.");
      return;
    }
    const picture = await loadArt(song?.image || ""),
      control = new AbortController();
    recording = control;
    ++drawing;
    cancelAnimationFrame(preview);
    recordingProgress(0, span.end - span.start);
    status.textContent = t("Keep this window open while the video records.");
    dialog.classList.add("is-recording");
    labels();
    const take = art =>
      recordStory({
        canvas,
        scene: storyScene({ song, picture: art, style, tone: accent(), window: span }),
        url,
        signal: control.signal,
        onProgress: recordingProgress,
      });
    try {
      // A cover without CORS taints the canvas; the video is then made without it.
      const video = await take(picture).catch(error => {
        if (error?.name !== "SecurityError" || !picture) throw error;
        return take(null);
      });
      if (!video) {
        status.textContent = t("Recording stopped.");
        return;
      }
      status.textContent = t("Saving the video…");
      const saved = await invoke("save_lyric_story", {
        video: await base64(video),
        name: storyFileName(song?.title, song?.artists?.[0]),
      });
      status.textContent = saved ? t("Video saved. Post it as a story or a short.") : "";
    } catch (error) {
      status.textContent = error?.message || t("Could not make the video.");
    } finally {
      recording = null;
      dialog.classList.remove("is-recording");
      labels();
      // Back to the looping preview, keeping the message about the saved video.
      if (dialog.open && format === "video") {
        const note = status.textContent;
        await draw();
        status.textContent = note;
      }
    }
  }
  dialog.addEventListener("close", () => {
    cancelAnimationFrame(preview);
    recording?.abort();
  });
  save.addEventListener("click", async () => {
    if (format === "video") {
      void recordVideo();
      return;
    }
    try {
      if (
        await invoke("save_lyric_card", {
          png: await base64(await blob()),
          name: cardFileName(song?.title, song?.artists?.[0]),
        })
      )
        status.textContent = t("Picture saved.");
    } catch {
      status.textContent = t("Could not save the picture.");
    }
  });

  function labels() {
    title.textContent = t("Share a line");
    close.title = close.ariaLabel = t("Close");
    styleLabel.textContent = t("Look");
    linesLabel.textContent = t("Lines (up to four)");
    linesLabel.textContent = t("Lines");
    linesCount.title = t("Lines (up to four)");
    copy.lastChild.textContent = t("Copy picture");
    save.lastChild.textContent =
      format !== "video" ? t("Save picture") : recording ? t("Stop recording") : t("Record video");
    save.firstChild.dataset.icon = format === "video" ? "video" : "download-simple";
    formatButtons[0].lastChild.textContent = t("Picture");
    formatButtons[1].lastChild.textContent = t("Video");
    formats.ariaLabel = t("Format");
    styleButtons.forEach((node, index) => {
      const value = STYLES[index][1];
      node.lastChild.textContent =
        value === "Cover" ? t("Cover") : value === "Colour" ? t("Colour") : t("Night");
    });
  }
  labels();
  onLanguageChange(labels);
  syncStyles();
  for (const node of formatButtons) node.setAttribute("aria-checked", String(node.dataset.format === format));

  function open(at = -1) {
    snapshot = lyrics.snapshot();
    song = getSong();
    if (!song || !snapshot.lines.some(line => line.trim())) return false;
    pick = startingPick(snapshot.lines, at >= 0 ? at : snapshot.active);
    status.textContent = "";
    const timeline = lyrics.timeline();
    timed = timeline.id === snapshot.id ? timeline : null;
    // The look swatches show this song: its cover blurred, its colour, and night.
    const thumb = artworkCandidates(song.image || "", 120)[0];
    styles.style.setProperty("--swatch-art", thumb ? `url("${thumb.replace(/"/g, "%22")}")` : "none");
    styles.style.setProperty("--swatch-tone", accent());
    renderList();
    void draw();
    if (!dialog.open) dialog.showModal();
    return true;
  }
  // A right click on a lyric line starts the card from that line.
  document.addEventListener("contextmenu", event => {
    const row =
      event.target instanceof Element && event.target.closest(".music-lyrics-scroll .music-lyric-line");
    if (!row) return;
    const index = [...row.parentElement.children].indexOf(row);
    if (open(index)) event.preventDefault();
  });
  return {
    open,
    button: (() => {
      const node = button(t("Share a line"), "image", () => open());
      node.classList.add("music-lyric-card-open");
      onLanguageChange(() => {
        node.title = node.ariaLabel = t("Share a line");
      });
      return node;
    })(),
  };
}
