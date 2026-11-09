import { timedLyrics } from "./music-lyrics-timing.js";

export function ttmlTime(value) {
  if (typeof value !== "string" || !value.trim()) return NaN;
  if (/^\d+(?:\.\d+)?ms$/.test(value)) return Number(value.slice(0, -2)) / 1000;
  if (/^\d+(?:\.\d+)?s?$/.test(value)) return Number(value.replace(/s$/, ""));
  if (!/^\d+(?::\d{1,2}){1,2}(?:\.\d+)?$/.test(value)) return NaN;
  return value.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
}

// TTML is data, never HTML. Keep the provider's word/syllable timestamps;
// whitespace belongs to the preceding segment, not to a fabricated timestamp.
export function parseTtml(raw, duration, Parser = globalThis.DOMParser, verifiedDuration = NaN) {
  if (typeof raw !== "string" || raw.length > 500000 || /<!DOCTYPE|<!ENTITY/i.test(raw) || !Parser) return [];
  const doc = new Parser().parseFromString(raw, "application/xml");
  if (doc.getElementsByTagName("parsererror").length || doc.documentElement?.localName !== "tt") return [];
  const body = [...doc.getElementsByTagNameNS("*", "body")][0];
  const declared = body?.hasAttribute("dur") ? ttmlTime(body.getAttribute("dur")) : verifiedDuration;
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(declared) ||
    Math.abs(declared - duration) > 3
  )
    return [];
  const paragraphs = [...doc.getElementsByTagNameNS("*", "p")];
  if (paragraphs.length > 3000) return [];
  const lines = [];
  for (const p of paragraphs) {
    const at = ttmlTime(p.getAttribute("begin")),
      end = ttmlTime(p.getAttribute("end"));
    if (!Number.isFinite(at) || !Number.isFinite(end) || at < 0 || end <= at || end > duration + 1) continue;
    const vocals = node => {
      let text = "",
        words = [],
        valid = true;
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          const whitespace = child.textContent;
          if (whitespace.trim()) valid = false;
          text += whitespace;
          if (words.length) words.at(-1).text += whitespace;
          else if (whitespace) valid = false;
        } else if (child.nodeType === 1 && child.getAttribute("ttm:role") !== "x-bg") {
          const value = child.textContent || "";
          text += value;
          const start = ttmlTime(child.getAttribute("begin")),
            stop = ttmlTime(child.getAttribute("end"));
          if (
            child.localName !== "span" ||
            child.children.length ||
            !value ||
            !Number.isFinite(start) ||
            !Number.isFinite(stop) ||
            stop <= start ||
            start < at ||
            stop > end
          )
            valid = false;
          words.push({ text: value, at: start, end: stop });
        }
      }
      return { text, words: valid ? words : [] };
    };
    const lead = vocals(p),
      backing = [...p.children].filter(child => child.getAttribute("ttm:role") === "x-bg").map(vocals);
    const backgroundText = backing
        .map(part => part.text)
        .join(" ")
        .trim(),
      background = backing.every(part => part.words.length) ? backing.flatMap(part => part.words) : [];
    const main = lead.text.trim()
      ? lead
      : { text: background.map(word => word.text).join("") || backgroundText, words: background };
    if (main.text.length > 8000 || !main.text.trim()) continue;
    lines.push({
      text: main.text,
      at,
      end,
      words: main.words,
      agent: p.getAttribute("ttm:agent") || "",
      ...(main === lead && backgroundText ? { backgroundText, background } : {}),
    });
  }
  const result = timedLyrics(lines);
  // Reject providers claiming word timing but assigning every word the same time.
  return result.some(l => l.words.length > 1 && new Set(l.words.map(w => w.at)).size > 1) ? result : [];
}

const wordsOf = text => (text || "").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
export function richerLyricsFit(candidate, original) {
  if (!candidate?.length) return false;
  const wanted = wordsOf(original?.plain || original?.lines?.map(l => l.text).join(" ") || "");
  if (!wanted.length) return true;
  const available = wordsOf(
      candidate.map(l => [l.text, l.backgroundText].filter(Boolean).join(" ")).join(" "),
    ),
    counts = new Map();
  for (const word of available) counts.set(word, (counts.get(word) || 0) + 1);
  let shared = 0;
  for (const word of wanted) {
    if (counts.get(word) > 0) {
      shared++;
      counts.set(word, counts.get(word) - 1);
    }
  }
  return shared >= wanted.length * 0.8 && available.length >= wanted.length * 0.8;
}
