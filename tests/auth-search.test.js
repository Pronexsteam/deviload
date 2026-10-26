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
    $, invoke, t, node:element, setPose() {}, syncAuth() {}, renderAccount() {}, errorText:String,
    savedAuthSource:{mode:"account",path:""},
    localStorage:{setItem:(key, value) => saved.set(key, value)},
  });
  return {$, saved};
}

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

test("Cinema replaces standalone web search while local and music search remain",()=>{
 const html=readFileSync(new URL("../src/index.html",import.meta.url),"utf8");
 for(const id of ["cinema-tab","cinema-home-form","media-library-search","music-search"])assert.ok(html.includes('id="'+id+'"'));
 assert.ok(!html.includes('id="media-search-form"'));assert.ok(!html.includes('id="search-tab"'));
 assert.ok(!source.includes('invoke("search_media"'));
});
