// Layout for a lyric card: which lines go on it and how big they can be.
export const CARD = { width: 1080, height: 1350, pad: 96, maxLines: 4 };

// Chosen lines in song order, at most four, starting from the one being sung (or the first line).
export function startingPick(lines, active) {
  if (!lines.length) return [];
  const first =
    active >= 0 && active < lines.length && lines[active].trim()
      ? active
      : lines.findIndex(line => line.trim());
  return first < 0 ? [] : [first];
}
export function togglePick(pick, index, lines) {
  if (!lines[index]?.trim()) return pick;
  if (pick.includes(index)) return pick.length > 1 ? pick.filter(value => value !== index) : pick;
  return [...pick, index].sort((a, b) => a - b).slice(-CARD.maxLines);
}

// Words broken into rows no wider than [width], each sung line starting a new row; null marks the small
// gap between two sung lines.
export const GAP = 0.35;
export function wrapRows(texts, width, measure) {
  const rows = [];
  for (const text of texts) {
    if (rows.length) rows.push(null);
    let row = "";
    for (const word of text.trim().split(/\s+/).filter(Boolean)) {
      const next = row ? `${row} ${word}` : word;
      if (row && measure(next) > width) {
        rows.push(row);
        row = word;
      } else row = next;
    }
    if (row) rows.push(row);
  }
  return rows;
}

// The largest size, from 76px down to 34px, at which the lines fit the text box.
export function fitRows(texts, { width, height }, measureAt) {
  for (let size = 76; size >= 34; size -= 4) {
    const rows = wrapRows(texts, width, text => measureAt(text, size));
    const lines = rows.reduce((sum, row) => sum + (row === null ? GAP : 1), 0);
    if (lines * size * 1.18 <= height) return { size, rows };
  }
  return { size: 34, rows: wrapRows(texts, width, text => measureAt(text, 34)) };
}

// A save name from the song: letters, digits, spaces and dashes, never empty.
export function cardFileName(title, artist) {
  const clean = value =>
    String(value || "")
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N} -]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  const name = [clean(artist), clean(title)].filter(Boolean).join(" - ").slice(0, 80).trim();
  return `${name || "Devil Music"} lyric.png`;
}
