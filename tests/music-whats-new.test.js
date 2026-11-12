import test from "node:test";
import assert from "node:assert/strict";
globalThis.document ??= { documentElement: { lang: "en" } };
const { NEWS } = await import("../src/music-whats-new.js");

test("each new feature names where it is announced and what the tip points at", () => {
  const keys = new Set();
  for (const item of NEWS) {
    assert.match(item.key, /^new-/);
    assert.ok(!keys.has(item.key), "keys are unique, so each tip shows once");
    keys.add(item.key);
    assert.ok(item.entry && item.target);
    assert.ok(item.title().length > 3 && item.text().length > 10);
  }
});
