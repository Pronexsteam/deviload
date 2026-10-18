import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import ru from "../src/locales/ru.js";
import es from "../src/locales/es.js";
import {supporters} from "../src/supporters-data.js";

class Node {
  constructor(tag) { this.tagName = tag.toUpperCase();this.children = [];this.listeners = new Map();this.attributes = {};this.className = "";this.textContent = "";this.hidden = false; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  click() { this.listeners.get("click")?.({target:this}); }
  set innerHTML(_) { throw new Error("Supporter names must never become HTML"); }
}
const source = readFileSync(new URL("../src/supporters.js", import.meta.url), "utf8")
  .replace(/^import .*;\r?\n/gm, "").replace("export function wireSupporters", "function wireSupporters");
const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
const find = (root, className) => descendants(root).find(node => node.className === className);
const names = root => descendants(root).filter(node => node.className === "supporter-name").map(node => node.textContent);
function setup(entries = supporters) {
  const root = new Node("section"), listeners = [];let language = "en", opened = 0;
  const wireSupporters = runInNewContext(source + "\nwireSupporters", {supporters:entries,
    document:{createElement:tag => new Node(tag)}, t:key => ({ru,es}[language]?.[key] || key), onLanguageChange:fn => listeners.push(fn)});
  const ui = wireSupporters({root, onSupport:() => opened++});
  return {root, ui, wireSupporters, get opened() { return opened; },
    language(value) { language = value;for (const listener of listeners) listener(); }};
}

test("the bundled board contains the confirmed public donor and no payment or account fields", () => {
  assert.ok(supporters.some(supporter => supporter.name === "anrynf"));
  assert.ok(Object.isFrozen(supporters));
  for (const supporter of supporters) { assert.ok(Object.isFrozen(supporter));assert.deepEqual(Object.keys(supporter), ["name"]); }
  const app = setup();assert.equal(app.root.hidden, false);assert.deepEqual(names(app.root), supporters.slice(0, 3).map(supporter => supporter.name));
  assert.deepEqual(descendants(app.root).filter(node => node.className === "supporter-rank").map(node => node.textContent), supporters.slice(0, 3).map((_, index) => "#" + (index + 1)));
});

test("manual ordering is retained, matching names stay separate, and at most three names appear", () => {
  const app = setup([{name:"Second alphabetically"}, {name:"Same"}, {name:"Same"}, {name:"Fourth"}]);
  assert.deepEqual(names(app.root), ["Second alphabetically", "Same", "Same"]);
  const ranks = descendants(app.root).filter(node => node.className === "supporter-rank");
  assert.deepEqual(ranks.map(node => node.textContent), ["#1", "#2", "#3"]);
  assert.ok(ranks.every(node => node.attributes["aria-hidden"] === "true"));
});

test("names render literally as untranslated text and cannot create markup or translated tooltips", () => {
  const app = setup([{name:"<img src=x onerror=alert(1)>"}, {name:"Downloads"}]);
  assert.deepEqual(names(app.root), ["<img src=x onerror=alert(1)>", "Downloads"]);
  for (const node of descendants(app.root).filter(node => node.className === "supporter-name")) {
    assert.equal(node.attributes.translate, "no");assert.equal(node.attributes.dir, "auto");assert.equal(node.title, undefined);
  }
  assert.equal(descendants(app.root).filter(node => node.tagName === "IMG").length, 1);
});

test("localized headings and Ko-fi action work without changing donor names", () => {
  const app = setup([{name:"Downloads"}]);
  app.language("ru");assert.equal(descendants(app.root).find(node => node.tagName === "H2").textContent, ru["Top supporters"]);
  assert.equal(find(app.root, "outline small supporters-support").textContent, ru["Support on Ko-fi"]);
  assert.deepEqual(names(app.root), ["Downloads"]);
  app.language("es");assert.equal(descendants(app.root).find(node => node.tagName === "H2").textContent, es["Top supporters"]);
  find(app.root, "outline small supporters-support").click();assert.equal(app.opened, 1);
  assert.deepEqual(names(app.root), ["Downloads"]);
});

test("an empty manual list hides the board and wiring twice cannot duplicate its action", () => {
  const empty = setup([]);assert.equal(empty.root.hidden, true);assert.deepEqual(names(empty.root), []);
  const app = setup();const initialChildren = [...app.root.children];
  assert.equal(app.wireSupporters({root:app.root}), app.ui);assert.deepEqual(app.root.children, initialChildren);
  find(app.root, "outline small supporters-support").click();assert.equal(app.opened, 1);
});
