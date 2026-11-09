const RUSSIAN = [
  "a",
  "b",
  "v",
  "g",
  "d",
  "e",
  "zh",
  "z",
  "i",
  "y",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "r",
  "s",
  "t",
  "u",
  "f",
  "kh",
  "ts",
  "ch",
  "sh",
  "shch",
  "",
  "y",
  "",
  "e",
  "yu",
  "ya",
];
// Lowercase Russian letters are contiguous; the rest are Ukrainian and Belarusian.
const CYRILLIC = Object.fromEntries(
  [
    ...RUSSIAN.map((latin, i) => [String.fromCodePoint(0x430 + i), latin]),
    [0x451, "yo"],
    [0x454, "ye"],
    [0x456, "i"],
    [0x457, "yi"],
    [0x491, "g"],
    [0x45e, "w"],
  ].map(([key, value]) => [typeof key === "number" ? String.fromCodePoint(key) : key, value]),
);
const GREEK = {
  α: "a",
  ά: "a",
  β: "v",
  γ: "g",
  δ: "d",
  ε: "e",
  έ: "e",
  ζ: "z",
  η: "i",
  ή: "i",
  θ: "th",
  ι: "i",
  ί: "i",
  ϊ: "i",
  ΐ: "i",
  κ: "k",
  λ: "l",
  μ: "m",
  ν: "n",
  ξ: "x",
  ο: "o",
  ό: "o",
  π: "p",
  ρ: "r",
  σ: "s",
  ς: "s",
  τ: "t",
  υ: "y",
  ύ: "y",
  ϋ: "y",
  ΰ: "y",
  φ: "f",
  χ: "ch",
  ψ: "ps",
  ω: "o",
  ώ: "o",
};
const HANGUL_INITIAL = [
  "g",
  "kk",
  "n",
  "d",
  "tt",
  "r",
  "m",
  "b",
  "pp",
  "s",
  "ss",
  "",
  "j",
  "jj",
  "ch",
  "k",
  "t",
  "p",
  "h",
];
const HANGUL_VOWEL = [
  "a",
  "ae",
  "ya",
  "yae",
  "eo",
  "e",
  "yeo",
  "ye",
  "o",
  "wa",
  "wae",
  "oe",
  "yo",
  "u",
  "wo",
  "we",
  "wi",
  "yu",
  "eu",
  "ui",
  "i",
];
const HANGUL_FINAL = [
  "",
  "k",
  "k",
  "k",
  "n",
  "n",
  "n",
  "t",
  "l",
  "k",
  "m",
  "l",
  "l",
  "l",
  "p",
  "l",
  "m",
  "p",
  "p",
  "t",
  "t",
  "ng",
  "t",
  "t",
  "k",
  "t",
  "p",
  "t",
];
const KANA = {
  あ: "a",
  い: "i",
  う: "u",
  え: "e",
  お: "o",
  か: "ka",
  き: "ki",
  く: "ku",
  け: "ke",
  こ: "ko",
  さ: "sa",
  し: "shi",
  す: "su",
  せ: "se",
  そ: "so",
  た: "ta",
  ち: "chi",
  つ: "tsu",
  て: "te",
  と: "to",
  な: "na",
  に: "ni",
  ぬ: "nu",
  ね: "ne",
  の: "no",
  は: "ha",
  ひ: "hi",
  ふ: "fu",
  へ: "he",
  ほ: "ho",
  ま: "ma",
  み: "mi",
  む: "mu",
  め: "me",
  も: "mo",
  や: "ya",
  ゆ: "yu",
  よ: "yo",
  ら: "ra",
  り: "ri",
  る: "ru",
  れ: "re",
  ろ: "ro",
  わ: "wa",
  を: "o",
  ん: "n",
  が: "ga",
  ぎ: "gi",
  ぐ: "gu",
  げ: "ge",
  ご: "go",
  ざ: "za",
  じ: "ji",
  ず: "zu",
  ぜ: "ze",
  ぞ: "zo",
  だ: "da",
  ぢ: "ji",
  づ: "zu",
  で: "de",
  ど: "do",
  ば: "ba",
  び: "bi",
  ぶ: "bu",
  べ: "be",
  ぼ: "bo",
  ぱ: "pa",
  ぴ: "pi",
  ぷ: "pu",
  ぺ: "pe",
  ぽ: "po",
  ゔ: "vu",
  ぁ: "a",
  ぃ: "i",
  ぅ: "u",
  ぇ: "e",
  ぉ: "o",
};
const SMALL = { ゃ: "ya", ゅ: "yu", ょ: "yo" };
const SCRIPT = /[\u0400-\u04ff\u0370-\u03ff\uac00-\ud7a3\u3040-\u30ff]/;
const HAN = /[\u3400-\u9fff]/;

const hiragana = char => {
  const code = char.codePointAt(0);
  return code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : char;
};
const capitalize = (source, latin) =>
  source !== source.toLocaleLowerCase() && latin ? latin[0].toUpperCase() + latin.slice(1) : latin;

function kana(text) {
  const chars = [...text].map(hiragana);
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i],
      next = chars[i + 1];
    if (char === "\u3063") {
      const following = KANA[next] || "";
      out += following ? (following[0] === "c" ? "t" : following[0]) : "";
      continue;
    }
    if (char === "\u30fc") {
      out += out.at(-1) || "";
      continue;
    }
    const base = KANA[char];
    if (base && SMALL[next] && base.endsWith("i")) {
      const glide = SMALL[next],
        stem = base.slice(0, -1);
      out += ["sh", "ch", "j"].includes(stem) ? stem + glide.slice(1) : stem + glide;
      i++;
      continue;
    }
    out += base ?? char;
  }
  return out;
}

function hangul(char) {
  const code = char.codePointAt(0) - 0xac00;
  if (code < 0 || code > 11171) return char;
  return (
    HANGUL_INITIAL[Math.floor(code / 588)] +
    HANGUL_VOWEL[Math.floor((code % 588) / 28)] +
    HANGUL_FINAL[code % 28]
  );
}

export function needsRomanization(text) {
  return typeof text === "string" && SCRIPT.test(text) && !HAN.test(text);
}

// Han characters need a dictionary; lines that contain them are left alone.
export function romanize(text) {
  if (!needsRomanization(text)) return "";
  text = text.replace(/([\u039f\u03bf\u038c\u03cc])([\u03c5\u03cd])/g, (_, o) =>
    o.toLowerCase() === o ? "ou" : "Ou",
  );
  let out = "",
    korean = false;
  const flushKana = buffer => (buffer ? kana(buffer) : "");
  let buffer = "";
  for (const char of text) {
    if (/[\u3040-\u30ff]/.test(char)) {
      buffer += char;
      continue;
    }
    out += flushKana(buffer);
    buffer = "";
    const lower = char.toLocaleLowerCase();
    if (CYRILLIC[lower] !== undefined) out += capitalize(char, CYRILLIC[lower]);
    else if (GREEK[lower] !== undefined) out += capitalize(char, GREEK[lower]);
    else if (/[\uac00-\ud7a3]/.test(char)) {
      out += (korean && /[a-z]$/.test(out) ? "" : "") + hangul(char);
      korean = true;
      continue;
    } else out += char;
    korean = false;
  }
  out += flushKana(buffer);
  return out.replace(/\s+/g, " ").trim();
}

export function lyricsScript(lines) {
  const text = lines.map(line => line.text || "").join(" ");
  if (/[\uac00-\ud7a3]/.test(text)) return "ko";
  if (/[\u3040-\u30ff]/.test(text)) return "ja";
  if (HAN.test(text)) return "zh";
  if (/[\u0370-\u03ff]/.test(text)) return "el";
  if (/[\u0400-\u04ff]/.test(text)) return /[\u0456\u0457\u0454\u0491]/i.test(text) ? "uk" : "ru";
  return /[A-Za-z]/.test(text) ? "latin" : "";
}

const STOPWORDS = {
  en: ["the", "you", "and", "my", "me", "your", "love", "i", "it", "is", "to", "in", "of", "we"],
  es: ["que", "el", "la", "de", "y", "mi", "tu", "en", "no", "me", "te", "amor", "por", "con"],
  pt: ["que", "n\u00e3o", "voc\u00ea", "eu", "meu", "com", "uma", "de", "e", "o", "do", "da"],
  fr: ["je", "tu", "le", "la", "et", "les", "des", "pas", "mon", "est", "une", "moi"],
  de: ["ich", "du", "und", "die", "der", "das", "nicht", "mein", "ist", "mich", "dich", "ein"],
  it: ["che", "non", "il", "la", "di", "mi", "ti", "sono", "per", "una", "cuore", "amore"],
};

// Script first, then common words for Latin-script lyrics.
export function lyricsLanguage(lines) {
  const script = lyricsScript(lines);
  if (script !== "latin") return script;
  const words =
    lines
      .map(line => line.text || "")
      .join(" ")
      .toLocaleLowerCase()
      .match(/[a-z\u00e0-\u00ff]+/g) || [];
  let best = "en",
    score = 0;
  for (const [code, list] of Object.entries(STOPWORDS)) {
    const value = words.reduce((sum, word) => sum + (list.includes(word) ? 1 : 0), 0);
    if (value > score) {
      best = code;
      score = value;
    }
  }
  return best;
}

const readable = { ru: ["ru", "uk"], en: [], es: [] };

export function lyricsExtrasFor(lines, ui) {
  const source = lyricsLanguage(lines),
    seen = readable[ui] || [];
  const foreign = Boolean(source) && source !== ui && !seen.includes(source);
  return {
    source,
    romanize: foreign && lines.some(line => needsRomanization(line.text)),
    translate: foreign && source !== "zh",
  };
}

export function translatable(lines) {
  return [
    ...new Set(
      lines
        .map(line => (line.text || "").trim())
        .filter(text => text && /\p{L}/u.test(text) && text.length <= 400),
    ),
  ];
}
