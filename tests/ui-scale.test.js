import test from "node:test";
import assert from "node:assert/strict";
import { readUiScale, saveUiScale, applyUiScale, UI_SCALE_KEY } from "../src/ui-scale.js";

test("the interface size is remembered and only known sizes reach the windows", async () => {
  const data = new Map(),
    storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  assert.equal(readUiScale(storage), 1, "100 % until chosen");
  assert.equal(saveUiScale(1.25, storage), true);
  assert.equal(readUiScale(storage), 1.25);
  assert.equal(saveUiScale(3, storage), false);
  data.set(UI_SCALE_KEY, "7");
  assert.equal(readUiScale(storage), 1, "a damaged value falls back to 100 %");
  const calls = [];
  const invoke = async (command, args) => calls.push([command, args]);
  assert.equal(await applyUiScale(1.1, invoke), true);
  assert.equal(await applyUiScale(0.3, invoke), false);
  assert.deepEqual(calls, [["set_ui_scale", { scale: 1.1 }]]);
});
