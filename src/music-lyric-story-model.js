// Layout and timing for a lyric story: a short vertical video of a few sung lines with their sound.
export const STORY = { width: 1080, height: 1920, fps: 30, lead: 0.7, tail: 0.9, min: 4, max: 30 };

// The stretch of the song the video covers: from just before the first chosen line to just after the last,
// at least a few seconds and never longer than a story allows. Lines without timing make no video.
export function storyWindow(timeline, pick, duration = Infinity) {
  const lines = (Array.isArray(pick) ? pick : [])
    .map(index => timeline?.lines?.[index])
    .filter(line => line && Number.isFinite(line.at) && String(line.text || "").trim());
  if (!lines.length) return null;
  const start = Math.max(0, lines[0].at - STORY.lead);
  let end = Math.max(...lines.map(line => (Number.isFinite(line.end) ? line.end : line.at + 4))) + STORY.tail;
  end = Math.min(Math.max(end, start + STORY.min), start + STORY.max);
  // The song's own end comes first: a story never runs past it.
  if (Number.isFinite(duration) && duration > start) end = Math.min(end, duration);
  return { start, end, lines };
}

// The pieces of a line that light up: its timed words, or its words all lit when the line starts.
export function storyTokens(line) {
  const words = (Array.isArray(line?.words) ? line.words : []).filter(
    word => word && typeof word.text === "string" && word.text && Number.isFinite(word.at),
  );
  if (words.length)
    return words.map(word => ({
      text: word.text,
      at: word.at,
      end: Number.isFinite(word.end) ? Math.max(word.end, word.at) : word.at,
    }));
  return (String(line?.text || "").match(/\S+\s*/g) || []).map(text => ({ text, at: line.at, end: line.at }));
}

// Tokens grouped into words that never break across rows; a syllable split for timing stays whole.
export function storyChunks(tokens) {
  const chunks = [];
  let chunk = [];
  for (const token of tokens) {
    if (chunk.length && /^\s/.test(token.text)) {
      chunks.push(chunk);
      chunk = [];
    }
    chunk.push(token);
    if (/\s$/.test(token.text)) {
      chunks.push(chunk);
      chunk = [];
    }
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

// How many rows a line takes at [limit] wide.
function rowCount(chunks, limit, size, measure) {
  let rows = 1,
    left = 0;
  for (const chunk of chunks) {
    const text = chunk.map(token => token.text).join(""),
      wide = measure(text.trimEnd(), size);
    if (left > 0 && left + wide > limit) {
      rows++;
      left = 0;
    }
    left += measure(text, size);
  }
  return rows;
}
// The narrowest width that keeps a wrapped line to as few rows as it needs, so its rows come out even instead
// of a long row and a single word left alone below it.
export function balancedWidth(chunks, width, size, measure) {
  const rows = rowCount(chunks, width, size, measure);
  if (rows < 2) return width;
  let low = 0,
    high = width;
  for (let i = 0; i < 12; i++) {
    const middle = (low + high) / 2;
    if (rowCount(chunks, middle, size, measure) > rows) low = middle;
    else high = middle;
  }
  return Math.min(width, high + 1);
}

// Every token placed in the box at the largest size that fits, each sung line starting a new row; rows are
// centred. [measure(text, size)] gives a width in pixels.
export function storyLayout(lines, { x, y, width, height }, measure) {
  const chunked = lines.map(line => storyChunks(storyTokens(line)));
  for (let size = 92; size >= 40; size -= 4) {
    const rowHeight = Math.round(size * 1.2),
      gap = Math.round(size * 0.5),
      placed = [],
      ends = [];
    let row = -1,
      top = 0,
      fits = true;
    chunked.forEach((chunks, lineIndex) => {
      if (lineIndex) top += gap;
      let left = 0;
      row++;
      const limit = balancedWidth(chunks, width, size, measure);
      for (const chunk of chunks) {
        const text = chunk.map(token => token.text).join(""),
          wide = measure(text.trimEnd(), size);
        if (wide > width) fits = false;
        if (left > 0 && left + wide > limit) {
          left = 0;
          top += rowHeight;
          row++;
        }
        let at = left;
        for (const token of chunk) {
          const tokenWidth = measure(token.text, size);
          placed.push({ ...token, line: lineIndex, row, x: at, y: y + top + size, width: tokenWidth });
          at += tokenWidth;
        }
        ends[row] = left + wide;
        left = at;
      }
      top += rowHeight;
    });
    if (fits && top <= height) {
      const shift = Math.round((height - top) / 2);
      return {
        size,
        rows: row + 1,
        tokens: placed.map(token => ({
          ...token,
          x: x + token.x + Math.round((width - ends[token.row]) / 2),
          y: token.y + shift,
        })),
      };
    }
  }
  return null;
}

// A quiet shape for the waveform before the song plays: higher in the middle, never flat.
export function restingWave(count) {
  return Array.from({ length: count }, (_, i) => {
    const middle = 1 - Math.abs(i / (count - 1) - 0.5) * 1.4;
    return 0.18 + 0.32 * middle * (0.6 + 0.4 * Math.abs(Math.sin(i * 1.7)));
  });
}

// Song time as m:ss.
export const clockText = seconds => {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
};

// How lit a token is at [time]: 0 before it is sung, 1 once it is; a word without its own length fades in quickly.
export function tokenLight(token, time) {
  if (time <= token.at) return 0;
  const length = Math.max(0.18, token.end - token.at);
  return Math.min(1, (time - token.at) / length);
}

// The video fades in and out, and so does its sound.
export function storyFade(time, { start, end }) {
  return Math.max(0, Math.min(1, (time - start) / 0.35, (end - time) / 0.6));
}

export function storyFileName(title, artist) {
  const clean = value =>
    String(value || "")
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N} -]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  const name = [clean(artist), clean(title)].filter(Boolean).join(" - ").slice(0, 80).trim();
  return `${name || "Devil Music"} story`;
}

// The best format the recorder offers; MP4 goes straight to phones, WebM is turned into MP4 on saving.
export const STORY_TYPES = [
  "video/mp4;codecs=avc1.640028,mp4a.40.2",
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];
export const storyType = supported => STORY_TYPES.find(type => supported(type)) || "";
