import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync, readdirSync, statSync} from "node:fs";
import {join, relative} from "node:path";
import {fileURLToPath} from "node:url";
import ru from "../src/locales/ru.js";
import es from "../src/locales/es.js";
import {labels, diagnoseError} from "../src/view-model.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = path => readFileSync(join(root, path), "utf8");
const keys = new Set(Object.keys(ru));
// Brand names, formats and codes read the same in both languages.
const neutral = new Set(["Deviload", "Devil", "oad", "Devil Cut", "Devil Cut · Deviload", "DEVIL CINEMA", "YouTube", "YouTube Music", "VK", "TikTok",
  "Instagram", "Twitch", "SoundCloud", "1080p", "720p", "480p", "MP3", "FLAC", "WAV", "GIF", "GIF · 480px", "Chrome", "Edge",
  "Firefox", "Brave", "Safari", "yt-dlp", "RU", "EN", "I", "O", "MP4", "16:9", "9:16", "1:1", "4:5", "00:30", "01:15", "https://youtube.com/watch?v=…", "socks5://127.0.0.1:1080", "Plex", "http://192.168.1.10:8096"]);

function missing(strings) {
  return [...strings].filter(text => /[A-Za-z]/.test(text) && !neutral.has(text) && !keys.has(text));
}

function literals(code) {
  return [...code.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(match => JSON.parse(`"${match[1]}"`));
}

// Arguments of every t(...) call, with nested parentheses kept together.
function translatedLiterals(code, words = false) {
  const found = [];
  for (const match of code.matchAll(/\btn?\(/g)) {
    let depth = 1, index = match.index + match[0].length, quote = null;
    for (; index < code.length && depth; index++) {
      const char = code[index];
      if (quote) { if (char === "\\") index++; else if (char === quote) quote = null; continue; }
      if (char === "\"" || char === "'" || char === "`") quote = char;
      else if (char === "(") depth++;
      else if (char === ")") depth--;
    }
    const args = literals(code.slice(match.index + match[0].length, index - 1)).filter(text => words || !/^[a-z0-9-]+$/.test(text));
    // tn(one, many, ...): the Russian forms of both live under `many`.
    found.push(...(match[0] === "tn(" ? args.slice(1) : args));
  }
  return found;
}

function htmlStrings() {
  const html = (read("src/index.html") + read("src/cut.html") + read("src/converter.html")).replace(/<(script|style)[\s\S]*?<\/\1>/g, "").replace(/<svg[\s\S]*?<\/svg>/g, "");
  const strings = new Set();
  for (const [, text] of html.matchAll(/>([^<]+)</g)) if (text.trim()) strings.add(text.trim());
  for (const [, , value] of html.matchAll(/\s(placeholder|aria-label|title|alt|label|data-empty-label)="([^"]*)"/g)) {
    if (value.trim()) strings.add(value.trim());
  }
  return strings;
}

const RUST_MESSAGE = /(?:Err\(|ok_or\(|ok_or_else\(\|\| |push\(|map_err\(\|\w+\| |warning = |warning: )(?:format!\()?"((?:[^"\\]|\\.)*)"/g;
const normalize = text => text.replace(/\{[^}]*\}/g, "{}");

function rustMessages() {
  const found = [];
  for (const file of ["lib.rs", "model.rs", "share.rs", "watch.rs", "convert.rs", "power.rs", "media_server.rs"]) {
    const source = read(join("src-tauri/src", file)).split("#[cfg(test)]")[0];
    for (const [, text] of source.matchAll(RUST_MESSAGE)) {
      if (/^(?:[A-Z{]|yt-dlp )/.test(text)) found.push({file, text});
    }
  }
  return found;
}

function tableStrings() {
  const main = read("src/main.js");
  const tables = [
    block(main, "const stateNames =", "\n"), block(main, "const filters =", "\n"), block(main, "const pageTitles =", "\n"),
    block(main, "const description =", "\n"), block(main, "const emptyTitle =", ";"),
    block(main, "const title = {retry:", "\n"), block(main, "for (const [direction,title,icon] of", "\n"),
    ...[...read("src/tour.js").matchAll(/(?:title|text):"[^"]*"/g)].map(match => match[0]),
  ];
  const strings = tables.flatMap(literals).filter(text => !/^[a-z0-9-]+$/.test(text) && !text.endsWith("-tab"));
  strings.push(...Object.values(labels));
  for (const line of ["No space left", "n challenge solving failed", "Sign in to confirm you're not a bot", "Sign in to confirm your age",
    "Private video", "members-only", "not available in your country", "Video unavailable", "HTTP Error 429", "ffmpeg not found",
    "Requested format is not available", "Unsupported URL", "HTTP Error 403: Forbidden", "timed out", "login required", "Unable to connect to proxy", "unrelated"]) {
    for (const signedIn of [false, true]) {
      const issue = diagnoseError([line], signedIn);
      strings.push(issue.title, issue.message);
    }
  }
  return strings;
}

function block(code, start, end) {
  const from = code.indexOf(start);
  assert.notEqual(from, -1, start);
  return code.slice(from, code.indexOf(end, from + start.length));
}

test("static HTML text has a Russian translation", () => {
  assert.deepEqual(missing(htmlStrings()), []);
});

test("strings passed to t() have a Russian translation", () => {
  for (const file of ["src/main.js", "src/tour.js", "src/devil-mascot.js", "src/devil-cut.js", "src/cut-main.js", "src/converter.js"]) {
    assert.deepEqual(missing(translatedLiterals(read(file))), [], file);
  }
});

test("label tables and error hints have a Russian translation", () => {
  assert.deepEqual(missing(tableStrings()), []);
});

test("messages from the Rust core have a Russian translation", () => {
  const known = new Set([...keys].map(normalize));
  const absent = rustMessages().filter(({text}) => !known.has(normalize(text))).map(({file, text}) => `${file}: ${text}`);
  assert.deepEqual(absent, []);
});

test("the Russian locale has no unused strings", () => {
  const used = new Set([...htmlStrings(), ...tableStrings(), "Deviload — Downloads"]);
  for (const file of ["src/main.js", "src/tour.js", "src/devil-mascot.js", "src/devil-cut.js", "src/cut-main.js", "src/converter.js"]) for (const text of translatedLiterals(read(file), true)) used.add(text);
  const rust = new Set(rustMessages().map(({text}) => normalize(text)));
  const unused = [...keys].filter(key => !used.has(key) && !rust.has(normalize(key)));
  assert.deepEqual(unused, []);
});

test("translations keep every placeholder", () => {
  const names = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const [key, value] of Object.entries(ru)) {
    for (const form of [value].flat()) assert.deepEqual(names(form), names(key), key);
  }
});

test("Cyrillic text lives only in the Russian locale", () => {
  const skip = new Set(["node_modules", "target", "gen", ".git", ".work", "bin", "dist", "vendor"]);
  const offenders = [];
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { walk(path); continue; }
      if (!/\.(js|mjs|html|css|rs|toml|json|md|yml|ps1|sh)$/.test(name)) continue;
      const file = relative(root, path).replaceAll("\\", "/");
      if (file === "src/locales/ru.js" || file === "README.md") continue;
      if (/\p{Script=Cyrillic}/u.test(readFileSync(path, "utf8"))) offenders.push(file);
    }
  };
  walk(root);
  assert.deepEqual(offenders, []);
});

test("the Spanish locale matches the Russian one key for key", () => {
  const placeholders = text => [...String(text).matchAll(/\{\w+\}/g)].map(match => match[0]).sort();
  const problems = Object.keys(es).filter(key => !(key in ru)).map(key => `not in ru.js: ${key}`);
  for (const [key, russian] of Object.entries(ru)) {
    const spanish = es[key];
    if (spanish === undefined) { problems.push(`missing: ${key}`); continue; }
    if (Array.isArray(russian) !== Array.isArray(spanish) || (Array.isArray(spanish) && spanish.length !== 2)) { problems.push(`plural forms: ${key}`); continue; }
    // A singular form may spell the number out; every other form keeps the placeholders of the English.
    const forms = Array.isArray(spanish) ? spanish.slice(1) : [spanish];
    for (const form of forms) if (placeholders(form).join() !== placeholders(key).join()) problems.push(`placeholders: ${key}`);
    if (Array.isArray(spanish) && placeholders(spanish[0]).some(name => !placeholders(key).includes(name))) problems.push(`placeholders: ${key}`);
  }
  assert.deepEqual(problems, []);
});

