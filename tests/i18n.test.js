import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync, readdirSync, statSync} from "node:fs";
import {join, relative} from "node:path";
import {fileURLToPath} from "node:url";
import {runInNewContext} from "node:vm";
import ru from "../src/locales/ru.js";
import es from "../src/locales/es.js";
import {labels, diagnoseError} from "../src/view-model.js";
import {playbackFailure} from "../src/music-diagnostics.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = path => readFileSync(join(root, path), "utf8");
const keys = new Set(Object.keys(ru));
const translatedSources = ["src/main.js", "src/app-release-notes.js", "src/devil-music.js", ...readdirSync(join(root,"src")).filter(name=>/^music-.*\.js$/.test(name)).map(name=>"src/"+name), "src/tour.js", "src/devil-mascot.js", "src/devil-cut.js", "src/quick-cut.js", "src/cut-main.js", "src/converter.js", "src/export-folder.js", "src/download-profiles.js", "src/download-options.js", "src/queue-selection.js", "src/settings-backup.js"];
// Brand names, formats and codes read the same in both languages.
const neutral = new Set(["Deviload", "Devil Music", "01 / DM", "Devil", "oad", "Devil Cut", "Devil Cut · Deviload", "Devil Convert", "Devil Convert · Deviload", "DEVIL CINEMA", "YouTube", "YouTube Music", "VK", "TikTok",
  "Instagram", "Twitch", "SoundCloud", "1080p", "720p", "480p", "1440p", "4K", "H.264", "H.265", "MP3", "FLAC", "WAV", "GIF", "GIF · 480px", "Chrome", "Edge",
  "Firefox", "Brave", "Safari", "yt-dlp", "RU", "EN", "I", "O", "MP4", "MKV", "WebM", "16:9", "9:16", "1:1", "4:5", "00:30", "01:15", "https://youtube.com/watch?v=…", "socks5://127.0.0.1:1080", "Plex", "http://192.168.1.10:8096"]);

function missing(strings) {
  return [...strings].filter(text => /[A-Za-z]/.test(text) && !neutral.has(text) && !keys.has(text));
}

function literals(code) {
  return [...code.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)].map(match => match[1]!==undefined?JSON.parse(`"${match[1]}"`):match[2].replace(/\\(['\\])/g,'$1'));
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
  const profileHtml=[...(read("src/download-profiles.js")+read("src/settings-backup.js")).matchAll(/innerHTML='([^']*)'/g)].map(match=>match[1]).join('');
  const html = (read("src/index.html") + read("src/cut.html") + read("src/converter.html")+profileHtml).replace(/<(script|style)[\s\S]*?<\/\1>/g, "").replace(/<svg[\s\S]*?<\/svg>/g, "");
  const strings = new Set();
  for (const [, text] of html.matchAll(/>([^<]+)</g)) if (text.trim()) strings.add(text.trim());
  for (const [, , value] of html.matchAll(/\s(placeholder|aria-label|title|alt|label|data-empty-label)="([^"]*)"/g)) {
    if (value.trim()) strings.add(value.trim());
  }
  for(const file of ['src/download-profiles.js','src/download-profile-data.js','src/download-options.js','src/quick-cut.js','src/settings-backup.js','src/cut-editing.js',...translatedSources.filter(path=>path.startsWith('src/music-'))]) {
    for(const [,message] of read(file).matchAll(/(?:Error|warn)\(["']([^"']+)["']/g))strings.add(message);
    for(const [,message] of read(file).matchAll(/warnings\.push\("([^"]+)"/g))strings.add(message);
  }
  for(const error of ["HTTP 429", "restricted", "timed out", "Music engine is busy", "Could not start music engine", "Network failed", "decode", "unsupported", "unknown", "unplayable", "HTTP 403", "not available in your country"]){
    strings.add(playbackFailure(error).message);
  }
  return strings;
}

const RUST_MESSAGE = /(?:Err\(\s*|ok_or\(\s*|ok_or_else\(\|\|\s*|push\(\s*|map_err\(\|\w+\|\s*|warning = |warning: |const CATALOG_ERROR: &str = )(?:format!\()?"((?:[^"\\]|\\.)*)"/g;
const normalize = text => text.replace(/\{[^}]*\}/g, "{}");

function rustMessages() {
  const found = [];
  for (const file of ["lib.rs", "music.rs", "music_audio.rs", "music_profile.rs", "music_import.rs", "music_playlist_import.rs", "music_lyrics.rs", "music_offline.rs", "music_engine_diagnostics.rs", "download_details.rs", "quick_cut.rs", "cookies.rs", "engine_update.rs", "model.rs", "share.rs", "settings_backup.rs", "watch.rs", "convert.rs", "power.rs", "media_server.rs"]) {
    const source = read(join("src-tauri/src", file)).split("#[cfg(test)]")[0];
    // Start inside the body so Rust lifetimes such as &'static are not parsed
    // as single-quoted JavaScript strings by literals().
    if(file === "music.rs")for(const text of literals(block(source,"let error = String::from_utf8_lossy(stderr)", "struct ResolveFailure")))if(text.endsWith("."))found.push({file,text});
    if(file === "music_import.rs" || file === "music_playlist_import.rs" || file === "quick_cut.rs")for(const [,text] of source.matchAll(/const \w+: &str = "([^"]+)";/g))found.push({file,text});
    if(file === "quick_cut.rs")for(const [,text]of source.matchAll(/Some\("([A-Z][^"]*[.!?])"/g))found.push({file,text});
    for (const [, text] of source.matchAll(RUST_MESSAGE)) {
      if (/^(?:[A-Z{]|yt-dlp )/.test(text)) found.push({file, text});
    }
  }
  const reportCommand=block(read("src-tauri/src/music_engine.rs"),"pub async fn export_music_diagnostics", "\nfn update()");
  for(const [,text]of reportCommand.matchAll(/"([^"\n]+\.)"/g))found.push({file:"music_engine.rs",text});
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
  for (const url of ["https://www.instagram.com/p/x/", "https://example.com/v"]) {
    for (const signed of [true, false]) for (const line of ["login required", "empty media response", "not available to everyone", "HTTP Error 429", "selected cookies file contains no active Instagram session"]) {
      const issue = diagnoseError([line], signed, url);
      strings.push(issue.title, issue.message);
    }
  }
  strings.push(...literals(block(main, "const stages =", "\n")));
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
  for (const file of translatedSources) {
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

test("music engine playback restrictions have translations", () => {
  const messages = literals(read("engines/music/errors.ts")).filter(text => text.startsWith("Playback "));
  assert.ok(messages.length > 0);
  assert.deepEqual(missing(messages), []);
});

test("the Russian locale has no unused strings", () => {
  const used = new Set([...htmlStrings(), ...tableStrings(), "Deviload — Downloads"]);
  for (const file of translatedSources) for (const text of translatedLiterals(read(file), true)) used.add(text);
  const rust = new Set(rustMessages().map(({text}) => normalize(text)));
  for (const file of ["engines/music/engine.ts", "engines/music/errors.ts"]) {
    for (const text of literals(read(file))) used.add(text);
  }
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
  const skip = new Set(["node_modules", "target", "gen", ".git", ".work", ".playwright-cli", "bin", "dist", "vendor"]);
  const offenders = [];
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { walk(path); continue; }
      if (!/\.(js|mjs|html|css|rs|toml|json|md|yml|ps1|sh|nsh)$/.test(name)) continue;
      const file = relative(root, path).replaceAll("\\", "/");
      if (file === "src/locales/ru.js" || file === "src-tauri/windows/locales/ru.nsh") continue;
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

test("explicit dynamic labels switch from Russian to English and Spanish without replacing icons", () => {
  const element=(attributes={},text="")=>({
    attributes:{...attributes},textContent:text,children:[],
    getAttribute(name){return this.attributes[name]??null;},
    setAttribute(name,value){this.attributes[name]=value;},
    hasAttribute(name){return name in this.attributes;},
    closest(){return this.attributes.translate==="no"?this:null;},
    matches(selector){return selector.split(",").some(part=>this.hasAttribute(part.slice(1,-1)));},
    querySelectorAll(selector){return this.children.flatMap(child=>[child,...child.querySelectorAll(selector)]).filter(child=>child.matches(selector));}
  });
  const body=element(),downloaded=element({"data-i18n":"Downloaded music"},ru["Downloaded music"]);
  const iconButton=element({"data-i18n-title":"Lyrics","data-i18n-aria-label":"Lyrics"},"icon");
  const userContent=element({"data-i18n":"Downloaded music",translate:"no"},"My playlist");
  body.children=[downloaded,iconButton,userContent];
  const document={body,documentElement:{},createTreeWalker:()=>({nextNode:()=>null})};
  const code=read("src/i18n.js").replace(/^import .*;\r?\n/gm,"").replace(/\bexport /g,"");
  const api=runInNewContext(code+";({setLanguage,translateDom})",{ru,es,russian:"ru",spanish:"es",document,NodeFilter:{SHOW_TEXT:4},localStorage:{getItem:()=>"ru",setItem(){}},navigator:{language:"en"}});
  api.translateDom();assert.equal(downloaded.textContent,ru["Downloaded music"]);
  api.setLanguage("en");assert.equal(downloaded.textContent,"Downloaded music");assert.equal(iconButton.getAttribute("title"),"Lyrics");assert.equal(iconButton.getAttribute("aria-label"),"Lyrics");
  api.setLanguage("es");assert.equal(downloaded.textContent,es["Downloaded music"]);assert.equal(iconButton.getAttribute("title"),es.Lyrics);
  assert.equal(iconButton.textContent,"icon");assert.equal(userContent.textContent,"My playlist");
  // The explicit root is translated too, useful when a new control is mounted.
  api.setLanguage("en");downloaded.textContent=ru["Downloaded music"];api.translateDom(downloaded);assert.equal(downloaded.textContent,"Downloaded music");
});

