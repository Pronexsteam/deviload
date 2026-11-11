import test from "node:test";
import assert from "node:assert/strict";
import { keepPresses } from "../src/press-capture.js";

// A button that records pointer capture, and a root that hands pointerdown to the listener.
function setup({ draggable = false, disabled = false, matches = true } = {}) {
  const calls = [];
  const handlers = {};
  const button = {
    draggable,
    disabled,
    getBoundingClientRect: () => ({ left: 100, right: 142, top: 50, bottom: 92 }),
    setPointerCapture: id => calls.push(["capture", id]),
    releasePointerCapture: id => calls.push(["release", id]),
    addEventListener: (name, fn) => (handlers[name] = fn),
    removeEventListener: name => delete handlers[name],
    closest: selector => (selector.startsWith("[draggable") ? null : button),
  };
  let down;
  const root = { addEventListener: (name, fn) => name === "pointerdown" && (down = fn) };
  keepPresses(root);
  const press = (extra = {}) =>
    down({ target: { closest: () => (matches ? button : null) }, button: 0, pointerType: "mouse", pointerId: 7, ...extra });
  return { calls, handlers, press };
}

test("a pressed player button keeps the press even after it shrinks under the pointer", () => {
  const { calls, handlers, press } = setup();
  press();
  assert.deepEqual(calls, [["capture", 7]]);
  // Still near the button (it shrank, the pointer did not move away): the press stays with it.
  handlers.pointermove({ clientX: 141, clientY: 70 });
  assert.deepEqual(calls, [["capture", 7]]);
});

test("moving clearly off the button lets go, so a press can still be cancelled", () => {
  const { calls, handlers, press } = setup();
  press();
  handlers.pointermove({ clientX: 160, clientY: 70 });
  assert.deepEqual(calls, [["capture", 7], ["release", 7]]);
  assert.equal(handlers.pointermove, undefined);
});

test("drag handles, disabled buttons, other buttons, touch and right clicks are left alone", () => {
  for (const [options, extra] of [
    [{ draggable: true }, {}],
    [{ disabled: true }, {}],
    [{ matches: false }, {}],
    [{}, { pointerType: "touch" }],
    [{}, { button: 2 }],
  ]) {
    const { calls, press } = setup(options);
    press(extra);
    assert.deepEqual(calls, [], JSON.stringify([options, extra]));
  }
});
