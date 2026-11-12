import test from "node:test";
import assert from "node:assert/strict";
const listeners = {};
globalThis.window = { addEventListener: (name, fn) => (listeners[name] = fn) };
const { browserKey } = await import("../src/native-menu-guard.js");

const key = (k, extra = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra });
const event = (target, extra = {}) => {
  const value = { target, defaultPrevented: false, prevented: false, ...extra };
  value.preventDefault = () => (value.prevented = true);
  return value;
};

test("reload, print, back, save and developer tools keys are the browser's, not Deviload's", () => {
  for (const k of [key("F5"), key("r", { ctrlKey: true }), key("p", { ctrlKey: true }), key("ArrowLeft", { altKey: true }), key("I", { ctrlKey: true, shiftKey: true }), key("F12"), key("s", { ctrlKey: true })])
    assert.equal(browserKey(k), true, JSON.stringify(k));
  for (const k of [key("c", { ctrlKey: true }), key("v", { ctrlKey: true }), key("a", { ctrlKey: true }), key("k", { ctrlKey: true }), key("ArrowRight", { ctrlKey: true }), key(" "), key("m")])
    assert.equal(browserKey(k), false, JSON.stringify(k));
});

test("right-click shows no browser menu, except in text fields and over selected text", () => {
  globalThis.getSelection = () => "";
  const plain = event({ closest: () => null });
  listeners.contextmenu(plain);
  assert.equal(plain.prevented, true);
  const field = event({ closest: () => ({}) });
  listeners.contextmenu(field);
  assert.equal(field.prevented, false);
  globalThis.getSelection = () => "a line of lyrics";
  const selected = event({ closest: () => null });
  listeners.contextmenu(selected);
  assert.equal(selected.prevented, false);
  // F5 is kept from reloading the page; the music page has already refreshed itself on the way.
  const refresh = event(null, { key: "F5" });
  listeners.keydown({ ...refresh, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault: refresh.preventDefault });
  assert.equal(refresh.prevented, true);
});
