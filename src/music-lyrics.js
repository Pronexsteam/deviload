import { t, errorText, onLanguageChange, language } from "./i18n.js";
import { lyricsExtras } from "./music-lyrics-extras.js";
import { timedLyrics, lyricFrame, parseLyrics, leadSinger } from "./music-lyrics-timing.js";
import { isLocalMusicId } from "./music-track-id.js";
import { clampLyricsOffset, readLyricsOffsets, saveLyricsOffset } from "./music-lyrics-preferences.js";
import { parseTtml, richerLyricsFit } from "./music-ttml.js";
import { songAlbum } from "./music-ui-model.js";
export { parseLyrics } from "./music-lyrics-timing.js";
export function createMusicLyrics({
  invoke,
  button,
  getTrack,
  getAudio,
  getLatency = () => 0,
  isPrivate = () => false,
}) {
  const dialog = document.createElement("dialog");
  dialog.className = "music-lyrics-dialog";
  dialog.setAttribute("aria-label", t("Lyrics"));
  const content = document.createElement("section"),
    heading = document.createElement("h2"),
    body = document.createElement("div"),
    credit = document.createElement("p");
  content.className = "music-lyrics-content";
  body.className = "music-lyrics-scroll";
  body.tabIndex = 0;
  body.setAttribute("aria-label", t("Lyrics"));
  credit.className = "music-lyrics-credit";
  credit.textContent = "LRCLIB";
  const toolbar = document.createElement("div");
  toolbar.className = "music-lyrics-tools";
  let fontSize = 28;
  try {
    fontSize = Math.max(20, Math.min(40, Number(localStorage.getItem("deviload-lyrics-size")) || 28));
  } catch {}
  const setSize = value => {
    fontSize = Math.max(20, Math.min(40, value));
    content.style.setProperty("--lyrics-size", fontSize + "px");
    try {
      localStorage.setItem("deviload-lyrics-size", String(fontSize));
    } catch {}
    smaller.disabled = fontSize <= 20;
    larger.disabled = fontSize >= 40;
  };
  const smaller = button(t("Smaller lyrics"), null, () => setSize(fontSize - 2)),
    larger = button(t("Larger lyrics"), null, () => setSize(fontSize + 2)),
    resume = button(t("Follow current line"), null, () => {
      manualUntil = 0;
      followPending = true;
      resume.hidden = true;
      update();
    });
  smaller.textContent = "A−";
  larger.textContent = "A+";
  resume.hidden = true;
  toolbar.append(smaller, larger, resume);
  setSize(fontSize);
  const extras = lyricsExtras({
    invoke,
    button,
    toolbar,
    storage: localStorage,
    language,
    isPrivate,
    onNote: note => {
      extraNote = note;
      updateCredit();
    },
  });
  let extraNote = "";
  let offsets = readLyricsOffsets(localStorage),
    offset = 0;
  const timing = document.createElement("details"),
    timingTitle = document.createElement("summary"),
    timingControls = document.createElement("div");
  timing.className = "music-lyrics-timing";
  timingTitle.textContent = t("Lyrics timing");
  const earlier = button(t("Show lyrics earlier"), null, () => adjustOffset(offset + 0.2)),
    later = button(t("Show lyrics later"), null, () => adjustOffset(offset - 0.2)),
    reset = button(t("Reset lyrics timing"), null, () => adjustOffset(0));
  earlier.textContent = "−0.2s";
  later.textContent = "+0.2s";
  timingControls.append(earlier, reset, later);
  timing.append(timingTitle, timingControls);
  toolbar.append(timing);
  function timingLabel() {
    const delay = -offset;
    reset.textContent = `${delay > 0 ? "+" : ""}${delay.toFixed(1)}s`;
    earlier.disabled = offset >= 10;
    later.disabled = offset <= -10;
  }
  function adjustOffset(value) {
    offset = clampLyricsOffset(value);
    offsets = saveLyricsOffset(localStorage, offsets, id, offset);
    timingLabel();
    manualUntil = 0;
    followPending = true;
    update();
  }
  timingLabel();
  const close = button(t("Close"), "x-circle", () => dialog.close());
  content.append(heading, toolbar, body, credit);
  dialog.append(close, content);
  document.body.append(dialog);
  const loadWatchers = new Set();
  let request = 0,
    id = null,
    lines = [],
    plainLines = [],
    active = -1,
    host = null,
    manualUntil = 0,
    followPending = false,
    frame = 0;
  const cache = new Map(),
    loading = new Map();
  let activeRows = new Set(),
    nearRows = new Set(),
    lastFrameAt = 0,
    hasWords = false;
  let syncLabel = "",
    source = "LRCLIB";
  const updateCredit = () => {
    credit.textContent =
      source +
      (syncLabel
        ? " · " + (syncLabel === "words" ? t("Word timing") : t("Line timing · word timing unavailable"))
        : "") +
      (extraNote ? " · " + extraNote : "");
  };
  const visible = () =>
    !document.hidden &&
    (dialog.open ||
      Boolean(
        host &&
        !host.hidden &&
        host.getClientRects().length &&
        (!host.closest("dialog") || host.closest("dialog").open),
      ));
  let scrollFrame = 0,
    scrollAt = 0,
    scrollGoal = 0,
    scrollTick = 0;
  const glide = now => {
    const step = Math.min(48, now - scrollTick || 16);
    scrollTick = now;
    scrollAt += (scrollGoal - scrollAt) * (1 - Math.exp(-step / 130));
    if (Math.abs(scrollGoal - scrollAt) < 0.5) {
      body.scrollTop = scrollGoal;
      scrollFrame = 0;
      return;
    }
    body.scrollTop = scrollAt;
    scrollFrame = requestAnimationFrame(glide);
  };
  const manualScroll = () => {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    body.classList.add("is-browsing");
    manualUntil = Date.now() + 8000;
    followPending = true;
    resume.hidden = !lines.length;
  };
  body.addEventListener("wheel", manualScroll, { passive: true });
  body.addEventListener("touchmove", manualScroll, { passive: true });
  body.addEventListener("pointerdown", event => {
    if (event.target === body) manualScroll();
  });
  body.addEventListener("keydown", event => {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) manualScroll();
  });
  function follow(row) {
    // A pane in transit between the sidebar and full player has no layout yet; retry on the next tick.
    if (!row || !body.clientHeight || !row.getClientRects().length) return;
    // Scroll only the lyrics pane; never move the surrounding modal/page.
    const target = Math.max(
      0,
      body.scrollTop +
        row.getBoundingClientRect().top -
        body.getBoundingClientRect().top -
        body.clientHeight * 0.3,
    );
    body.classList.remove("is-browsing");
    followPending = false;
    resume.hidden = true;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      body.scrollTop = target;
      return;
    }
    scrollGoal = target;
    cancelAnimationFrame(scrollFrame);
    scrollAt = body.scrollTop;
    scrollTick = 0;
    scrollFrame = requestAnimationFrame(glide);
  }
  async function load() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    hasWords = false;
    extras.attach(null, [], null);
    syncLabel = "";
    source = "LRCLIB";
    updateCredit();
    const track = getTrack();
    if (!track) {
      ++request;
      id = null;
      lines = [];
      plainLines = [];
      active = -1;
      heading.textContent = t("Lyrics");
      body.textContent = t("Start playback to load lyrics.");
      return;
    }
    const token = ++request;
    id = track.id;
    heading.textContent = host ? t("Lyrics") : track.title;
    body.textContent = t("Finding lyrics…");
    lines = [];
    plainLines = [];
    active = -1;
    manualUntil = 0;
    followPending = false;
    body.scrollTop = 0;
    try {
      if (isLocalMusicId(track.id)) {
        body.textContent = t("Online lyrics are not requested for local files.");
        body.dataset.lyricsState = "missing";
        return;
      }
      const duration = getAudio().duration;
      if (!Number.isFinite(duration) || duration <= 0) {
        body.textContent = t("Start playback to load lyrics.");
        id = null;
        return;
      }
      offset = offsets[track.id] || 0;
      timingLabel();
      const args = {
        title: track.title,
        artist: track.artists?.join(", ") || track.subtitle?.split(" · ")[0] || "",
        duration,
      };
      const album = songAlbum(track);
      const key = JSON.stringify([track.id, args.title, args.artist, album, Math.round(duration)]);
      const wordKey = "words:" + key;
      if (!cache.has(wordKey) && !loading.has(wordKey)) {
        loading.set(
          wordKey,
          Promise.resolve()
            .then(() => invoke("music_word_lyrics", { ...args, album }))
            .then(
              value => {
                if (cache.size >= 60) cache.delete(cache.keys().next().value);
                cache.set(wordKey, value);
                return value;
              },
              () => null,
            )
            .finally(() => loading.delete(wordKey)),
        );
      }
      const richer = cache.has(wordKey) ? Promise.resolve(cache.get(wordKey)) : loading.get(wordKey);
      let result = cache.get(key),
        failure = null;
      if (!cache.has(key)) {
        // Moving the same controller between sidebar and full player must not
        // start duplicate requests, nor let an older song replace the new one.
        if (!loading.has(key)) {
          const task = Promise.resolve()
            .then(() => invoke("music_lyrics", args))
            .then(value => {
              if (cache.size >= 60) cache.delete(cache.keys().next().value);
              cache.set(key, value);
              return value;
            })
            .finally(() => loading.delete(key));
          loading.set(key, task);
        }
        try {
          result = await loading.get(key);
        } catch (error) {
          result = null;
          failure = error;
        }
      }
      if (token !== request) return;
      function render(result) {
        body.replaceChildren();
        active = -1;
        plainLines = result?.instrumental
          ? []
          : String(result?.plain || "")
              .split("\n")
              .map(line => line.trim())
              .filter(Boolean);
        lines = result?.instrumental ? [] : timedLyrics(result?.lines);
        if (!lines.length && !result?.instrumental) lines = parseLyrics(result?.synced);
        activeRows = new Set();
        body.dataset.lyricsState = result?.instrumental
          ? "instrumental"
          : lines.length
            ? "synced"
            : result?.plain
              ? "plain"
              : "missing";
        queueMicrotask(() => {
          for (const watcher of loadWatchers) {
            try {
              watcher();
            } catch {
              /* A timeline must not break the lyrics. */
            }
          }
        });
        const lead = leadSinger(lines);
        if (lines.length) {
          for (const [lineIndex, line] of lines.entries()) {
            const row = button(
              line.text || (lineIndex === lines.length - 1 ? t("End of available lyrics") : "♪"),
              null,
              () => {
                const audio = getAudio();
                if (getTrack()?.id !== id || !Number.isFinite(audio.duration)) return;
                manualUntil = 0;
                followPending = true;
                audio.currentTime = Math.max(0, Math.min(line.at - offset, audio.duration));
                update();
              },
              "music-lyric-line",
            );
            if (line.agent && line.agent !== lead && line.agent !== "v1000") row.dataset.singer = "right";
            if (line.words?.length) {
              row.classList.add("has-word-sync");
              row.replaceChildren();
              const wordSpan = word => {
                const span = document.createElement("span");
                span.className = "music-lyric-word";
                span.textContent = word.text;
                span.setAttribute("aria-hidden", "true");
                return span;
              };
              row.append(...line.words.map(wordSpan));
              if (line.background?.length) {
                const backing = document.createElement("span");
                backing.className = "music-lyric-background";
                backing.append(...line.background.map(wordSpan));
                row.append(backing);
              }
              row.setAttribute("aria-label", [line.text, line.backgroundText].filter(Boolean).join(" "));
            } else if (line.backgroundText) {
              const backing = document.createElement("span");
              backing.className = "music-lyric-background";
              backing.textContent = line.backgroundText;
              row.append(backing);
            }
            body.append(row);
          }
        } else {
          const text = document.createElement("p");
          text.className = "music-lyrics-plain";
          text.textContent = result?.instrumental
            ? t("Instrumental")
            : result?.plain || t("No matching lyrics found.");
          body.append(text);
        }
        hasWords = lines.some(line => line.words?.length);
        syncLabel = hasWords ? "words" : lines.length ? "lines" : "";
        updateCredit();
        body.dataset.lyricsSync = hasWords ? "words" : lines.length ? "lines" : "none";
        nearRows = new Set();
        lastFrameAt = 0;
        update();
        extras.attach(body, lines, id);
      }
      render(result);
      let enriched = await richer;
      // A lost connection is not "no lyrics": offer Retry unless word timing filled the gap.
      const offerRetry = () => {
        if (token !== request || !failure || lines.length) return;
        body.dataset.lyricsState = "error";
        body.textContent = errorText(failure);
        body.append(button(t("Retry"), null, () => load(), "music-lyrics-retry"));
      };
      if (token !== request || result?.instrumental || hasWords) return;
      let candidate = parseTtml(enriched?.ttml, duration);
      if (!richerLyricsFit(candidate, result)) {
        const communityKey = "unison:" + key;
        if (!cache.has(communityKey) && !loading.has(communityKey)) {
          loading.set(
            communityKey,
            Promise.resolve()
              .then(() =>
                invoke("music_word_lyrics", { ...args, album, provider: "unison", videoId: track.id }),
              )
              .then(
                value => {
                  if (cache.size >= 60) cache.delete(cache.keys().next().value);
                  cache.set(communityKey, value);
                  return value;
                },
                () => null,
              )
              .finally(() => loading.delete(communityKey)),
          );
        }
        enriched = cache.has(communityKey) ? cache.get(communityKey) : await loading.get(communityKey);
        if (token !== request) return;
        candidate = parseTtml(enriched?.ttml, duration, globalThis.DOMParser, enriched?.duration);
      }
      if (richerLyricsFit(candidate, result)) {
        source = enriched.source || "Better Lyrics";
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        render({ ...result, lines: candidate });
      }
      offerRetry();
    } catch (error) {
      if (token === request) {
        body.dataset.lyricsState = "error";
        body.textContent = errorText(error);
        body.append(button(t("Retry"), null, () => load(), "music-lyrics-retry"));
      }
    }
  }
  // Other windows (the desktop strip, the mini-player) can follow the current line. While anyone does,
  // timing runs even when the lyrics are not on screen here; a line is shared when it changes, on pause,
  // seek or speed change, and once a second to keep their clocks honest.
  const watchers = new Set();
  let shared = { key: "", at: 0 };
  function share(time, audio) {
    if (!watchers.size) return;
    const line = lines[active],
      next = lines[active + 1],
      paused = audio.paused || audio.ended;
    const key = `${id}|${active}|${paused}|${audio.playbackRate}|${offset}`,
      stamp = performance.now();
    if (key === shared.key && stamp - shared.at < 1000) return;
    shared = { key, at: stamp };
    const payload = {
      id: id || "",
      position: Math.max(0, time),
      playing: !paused,
      rate: audio.playbackRate || 1,
      line: line
        ? {
            text: line.text || "",
            next: next?.text || "",
            at: line.at,
            end: line.end ?? next?.at ?? line.at + 5,
            words: (line.words || []).map(word => ({
              text: word.text,
              at: word.at,
              end: word.end ?? word.at,
            })),
          }
        : { text: "", next: lines[0]?.text || "", at: 0, end: 0, words: [] },
    };
    for (const watcher of watchers) {
      try {
        watcher(payload);
      } catch {
        /* A closed window must not stop the others. */
      }
    }
  }
  function update() {
    const shown = visible();
    if (!shown && !watchers.size) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      return;
    }
    if (getTrack()?.id !== id) {
      load();
      return;
    }
    const audio = getAudio(),
      states = lyricFrame(
        lines,
        audio.currentTime + offset - getLatency(),
        Number.isFinite(audio.duration) ? audio.duration + offset : Infinity,
      ),
      nextRows = new Set(states.map(state => state.index));
    for (const index of activeRows)
      if (!nextRows.has(index)) {
        const row = body.children[index];
        row?.classList.remove("active");
        row?.removeAttribute("aria-current");
      }
    for (const state of states) {
      const row = body.children[state.index];
      if (!row) continue;
      if (!activeRows.has(state.index)) {
        row.classList.add("active");
        row.setAttribute("aria-current", "true");
      }
      const paint = (span, word) => {
        if (!span) return;
        if (span.dataset.state !== word.state) span.dataset.state = word.state;
        const progress = (word.progress * 100).toFixed(1) + "%";
        if (span.style.getPropertyValue("--word-progress") !== progress)
          span.style.setProperty("--word-progress", progress);
      };
      state.words.forEach((word, i) => paint(row.children[i], word));
      const backing = row.querySelector(".music-lyric-background");
      state.background.forEach((word, i) => paint(backing?.children[i], word));
    }
    activeRows = nextRows;
    const index = states.at(-1)?.index ?? -1;
    if (index !== active) {
      active = index;
      followPending = index >= 0;
      for (const i of nearRows) {
        const row = body.children[i];
        row?.classList.remove("lyric-near");
        if (row) delete row.dataset.distance;
      }
      nearRows = new Set(index < 0 ? [] : [-4, -3, -2, -1, 1, 2, 3, 4].map(step => index + step));
      for (const i of nearRows) {
        const row = body.children[i];
        if (!row) continue;
        const distance = Math.abs(i - index);
        row.dataset.distance = String(distance);
        row.classList.toggle("lyric-near", distance === 1);
      }
    }
    if (shown && followPending && Date.now() >= manualUntil) follow(body.children[active]);
    share(audio.currentTime + offset - getLatency(), audio);
    if (!audio.paused && !audio.ended && !frame) {
      const tick = now => {
        frame = 0;
        if (now - lastFrameAt < 16) {
          frame = requestAnimationFrame(tick);
          return;
        }
        lastFrameAt = now;
        update();
      };
      frame = requestAnimationFrame(tick);
    }
  }
  document.addEventListener("visibilitychange", update);
  onLanguageChange(() => {
    timingTitle.textContent = t("Lyrics timing");
    earlier.title = earlier.ariaLabel = t("Show lyrics earlier");
    later.title = later.ariaLabel = t("Show lyrics later");
    reset.title = reset.ariaLabel = t("Reset lyrics timing");
  });
  dialog.addEventListener("close", () => {
    if (!host) {
      ++request;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }
  });
  onLanguageChange(() => {
    updateCredit();
    dialog.ariaLabel = body.ariaLabel = t("Lyrics");
    close.title = close.ariaLabel = t("Close");
    smaller.title = smaller.ariaLabel = t("Smaller lyrics");
    larger.title = larger.ariaLabel = t("Larger lyrics");
    resume.textContent = resume.title = resume.ariaLabel = t("Follow current line");
    if (host) heading.textContent = t("Lyrics");
  });
  return {
    open() {
      if (host) {
        load();
        body.focus();
        return;
      }
      dialog.showModal();
      load();
    },
    addTool(node) {
      toolbar.append(node);
    },
    // Timed lines on the song's own clock (the timing offset applied), for the timeline.
    timeline() {
      return {
        id: id || "",
        lines: lines.map((line, index) => ({
          text: line.text || "",
          at: line.at - offset,
          end: (line.end ?? lines[index + 1]?.at ?? line.at + 5) - offset,
        })),
      };
    },
    onLoad(watcher) {
      loadWatchers.add(watcher);
      return () => loadWatchers.delete(watcher);
    },
    // Loads the current song's lyrics without showing them.
    prefetch() {
      if (getTrack() && getTrack().id !== id) load();
    },
    // The song's lines as text, with the one being sung, for a lyric card.
    snapshot() {
      const texts = lines.length ? lines.map(line => line.text || "") : plainLines;
      return { id: id || "", lines: texts, active: lines.length ? active : -1 };
    },
    watch(watcher) {
      watchers.add(watcher);
      shared = { key: "", at: 0 };
      update();
      return () => watchers.delete(watcher);
    },
    mount(target) {
      host = target;
      if (dialog.open) dialog.close();
      host.append(content);
      load();
    },
    unmount() {
      ++request;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      host = null;
      id = null;
      dialog.append(content);
    },
    update,
  };
}
