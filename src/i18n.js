import ru from "./locales/ru.js";

const STORAGE_KEY = "deviload-lang";
const LANGUAGES = ["en", "ru"];
const tables = {ru};
const ATTRIBUTES = ["placeholder", "aria-label", "title", "alt", "label", "data-empty-label"];
const textSources = new WeakMap();
const attributeSources = new WeakMap();
const listeners = new Set();

function detectLanguage() {
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* storage unavailable */ }
  if (LANGUAGES.includes(saved)) return saved;
  return (navigator.language || "").toLowerCase().startsWith("ru") ? "ru" : "en";
}

let current = detectLanguage();

export function language() { return current; }
export function locale() { return current === "ru" ? "ru-RU" : "en-US"; }

function fill(text, params) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
}

// English source text is the key; missing translations fall back to it.
export function t(source, params) {
  const value = tables[current]?.[source] ?? source;
  return fill(Array.isArray(value) ? value[value.length - 1] : value, params);
}

// Count-dependent text. The Russian entry for `many` is [one, few, many].
export function tn(one, many, count, params = {}) {
  const values = {count, ...params};
  const russian = tables[current]?.[many];
  if (!Array.isArray(russian)) return fill(count === 1 ? one : many, values);
  const tens = count % 100, units = count % 10;
  const form = units === 1 && tens !== 11 ? 0 : units >= 2 && units <= 4 && (tens < 12 || tens > 14) ? 1 : 2;
  return fill(russian[form], values);
}

// Backend messages arrive in English and may carry runtime values, so keys
// with {placeholders} are matched as patterns.
const patterns = Object.keys(ru).filter(key => /\{\w+\}/.test(key)).map(key => {
  const names = [];
  const body = key.replace(/[.*+?^$()|[\]\\]/g, "\\$&")
    .replace(/\{(\w+)\}/g, (match, name) => { names.push(name); return "([\\s\\S]*?)"; });
  return {key, names, regex: new RegExp("^" + body + "$")};
});

export function translateMessage(text) {
  const value = String(text ?? "");
  const table = tables[current];
  if (!table) return value;
  if (typeof table[value] === "string") return table[value];
  for (const {key, names, regex} of patterns) {
    const match = regex.exec(value);
    if (match && typeof table[key] === "string") return fill(table[key], Object.fromEntries(names.map((name, index) => [name, match[index + 1]])));
  }
  return value;
}

export function errorText(error) {
  return translateMessage(error instanceof Error ? error.message : String(error));
}

function isKey(text) { return text in ru; }

export function translateDom(root = document.body) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || ["SCRIPT", "STYLE", "TEXTAREA"].includes(parent.tagName)) continue;
    let source = textSources.get(node);
    if (source === undefined) {
      const text = node.nodeValue.trim();
      if (!text || !isKey(text)) continue;
      source = text;
      textSources.set(node, source);
    }
    const [, lead, , trail] = node.nodeValue.match(/^(\s*)([\s\S]*?)(\s*)$/);
    node.nodeValue = lead + t(source) + trail;
  }
  const selector = ATTRIBUTES.map(name => `[${name}]`).join(",");
  for (const element of root.querySelectorAll(selector)) {
    let sources = attributeSources.get(element);
    if (!sources) { sources = {}; attributeSources.set(element, sources); }
    for (const name of ATTRIBUTES) {
      if (!element.hasAttribute(name)) continue;
      if (!(name in sources)) {
        const value = element.getAttribute(name).trim();
        if (!value || !isKey(value)) continue;
        sources[name] = value;
      }
      element.setAttribute(name, t(sources[name]));
    }
  }
}

export function setLanguage(next) {
  if (!LANGUAGES.includes(next) || next === current) return;
  current = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* storage unavailable */ }
  document.documentElement.lang = next;
  translateDom();
  for (const listener of listeners) listener(next);
}

export function onLanguageChange(listener) { listeners.add(listener); }

document.documentElement.lang = current;
