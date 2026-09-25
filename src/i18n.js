import ru, {name as russian} from "./locales/ru.js";
import es, {name as spanish} from "./locales/es.js";

const STORAGE_KEY = "deviload-lang";
const LANGUAGES = ["en", "ru", "es"];
const tables = {ru, es};
const ATTRIBUTES = ["placeholder", "aria-label", "title", "alt", "label", "data-empty-label"];
const textSources = new WeakMap();
const attributeSources = new WeakMap();
const listeners = new Set();

function detectLanguage() {
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* storage unavailable */ }
  if (LANGUAGES.includes(saved)) return saved;
  const system = (navigator.language || "").toLowerCase();
  return system.startsWith("ru") ? "ru" : system.startsWith("es") ? "es" : "en";
}

let current = detectLanguage();

export function language() { return current; }
// Each language is offered under its own name.
export const languageNames = {en:"English", ru:russian, es:spanish};
export function locale() { return {ru:"ru-RU", es:"es-ES"}[current] || "en-US"; }

function fill(text, params) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
}

// English source text is the key; missing translations fall back to it.
export function t(source, params) {
  const value = tables[current]?.[source] ?? source;
  return fill(Array.isArray(value) ? value[value.length - 1] : value, params);
}

// Count-dependent text. The entry for `many` holds the forms: Russian [one, few, many], Spanish [one, other].
export function tn(one, many, count, params = {}) {
  const values = {count, ...params};
  const forms = tables[current]?.[many];
  if (!Array.isArray(forms)) return fill(count === 1 ? one : many, values);
  if (forms.length === 2) return fill(forms[count === 1 ? 0 : 1], values);
  const tens = count % 100, units = count % 10;
  const form = units === 1 && tens !== 11 ? 0 : units >= 2 && units <= 4 && (tens < 12 || tens > 14) ? 1 : 2;
  return fill(forms[form], values);
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
