import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
function element() {
  return {value:"", textContent:"", hidden:false, disabled:false, children:[], listeners:{},
    addEventListener(name, callback) { this.listeners[name] = callback; },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; }};
}
function fixture(start, end, invoke) {
  const elements = new Map(), saved = new Map();
  const $ = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const t = (text, values = {}) => text.replace(/\{(\w+)\}/g, (_, key) => values[key]);
  runInNewContext(source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))), {
    $, invoke, t, node:element, setPose() {}, syncAuth() {}, errorText:String,
    localStorage:{setItem:(key, value) => saved.set(key, value)},
  });
  return {$, saved};
}
const submit = form => form.listeners.submit({preventDefault() {}});
const hit = id => ({url:`https://www.youtube.com/watch?v=${id}`, title:`Video ${id}`});

test("cookies are explicitly saved without adding a download and controls recover after failure", async () => {
  const calls = [];
  let fail = false;
  const {$, saved} = fixture('$("cookies-mode").addEventListener("change", () => {', '$("account-action").addEventListener', async (name, args) => {
    calls.push({name, ...args});
    if (fail) throw Error("Unreadable file");
    return 4;
  });
  $("cookies-mode").value = "file";
  $("cookies").value = " /home/test/cookies.txt ";
  $("cookies-mode").listeners.change();
  assert.equal(saved.size, 0);
  assert.match($("cookies-status").textContent, /Not saved/);
  await $("apply-cookies").listeners.click();
  assert.equal(calls[0].name, "apply_download_auth");
  assert.equal(calls[0].path, "/home/test/cookies.txt");
  assert.equal(saved.get("deviload-cookies-mode"), "file");
  assert.match($("cookies-status").textContent, /4 unexpired/);
  fail = true;
  await $("apply-cookies").listeners.click();
  assert.match($("cookies-status").textContent, /Unreadable/);
  for (const id of ["apply-cookies", "cookies-mode", "cookies", "browse-cookies"]) assert.equal($(id).disabled, false);
});

test("search appends pages, removes duplicate videos and hides Load more at the end", async () => {
  const calls = [];
  const {$} = fixture("let searchRequest =", "let inspectTimer =", async (_, args) => {
    calls.push({...args});
    return args.offset === 0 ? {hits:Array.from({length:20}, (_, i) => hit(i)), nextOffset:20}
      : {hits:[hit(19), hit(20)], nextOffset:null};
  });
  $("media-query").value = "music"; $("media-source").value = "youtube";
  await submit($("media-search-form"));
  assert.equal($("media-results").children.length, 20);
  assert.equal($("media-search-more").hidden, false);
  await $("media-search-more").listeners.click();
  // The click listener intentionally does not await; settle the invoke continuation.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[1].offset, 20);
  assert.equal($("media-results").children.length, 21);
  assert.equal($("media-search-more").hidden, true);
});

test("a failed next page keeps results and retries the same offset", async () => {
  let fail = true;
  const offsets = [];
  const {$} = fixture("let searchRequest =", "let inspectTimer =", async (_, args) => {
    offsets.push(args.offset);
    if (args.offset && fail) { fail = false; throw Error("Search timed out"); }
    return {hits:[hit(args.offset)], nextOffset:args.offset ? null : 20};
  });
  $("media-query").value = "music";
  await submit($("media-search-form"));
  $("media-search-more").listeners.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal($("media-results").children.length, 1);
  assert.equal($("media-search-more").disabled, false);
  $("media-search-more").listeners.click(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(offsets, [0,20,20]);
  assert.equal($("media-results").children.length, 2);
});

test("a late response cannot overwrite a newer search", async () => {
  const pending = [];
  const {$} = fixture("let searchRequest =", "let inspectTimer =", () => new Promise(resolve => pending.push(resolve)));
  $("media-query").value = "first"; const first = submit($("media-search-form"));
  $("media-query").value = "second"; const second = submit($("media-search-form"));
  pending[1]({hits:[hit(2)], nextOffset:null}); await second;
  pending[0]({hits:[hit(1)], nextOffset:20}); await first;
  assert.equal($("media-results").children.length, 1);
  assert.equal($("media-search-more").hidden, true);
});
