import test from "node:test";
import assert from "node:assert/strict";
// A tiny DOM: enough elements to hold text, children and click handlers, and a document that records events.
const element = () => {
  const node = { children: [], handlers: {}, textContent: "", disabled: false, hidden: false };
  node.append = (...items) => node.children.push(...items);
  node.addEventListener = (name, fn) => (node.handlers[name] = fn);
  node.insertBefore = item => node.children.push(item);
  return node;
};
const events = [];
globalThis.document = {
  documentElement: { lang: "en" },
  createElement: element,
  dispatchEvent: event => events.push(event),
};
const { wireMusicControlApi, controlApiRunning, controlApiExample, controlApiOverlay, CONTROL_API_EVENT } = await import("../src/music-control-api.js");
const { t } = await import("../src/i18n.js");
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const TOKEN = "ab".repeat(24);

function backend() {
  let state = { enabled: false, running: false, url: "http://127.0.0.1:17311/api/v1", token: "", error: null };
  const calls = [];
  const invoke = async (command, args) => {
    calls.push([command, args]);
    if (command === "music_control_api_set") {
      state = { ...state, enabled: args.enabled, running: args.enabled, token: args.renew || !state.token ? TOKEN.replace(/^ab/, args.renew ? "cd" : "ab") : state.token };
    }
    return state;
  };
  return { invoke, calls };
}

test("the control API row is off until turned on, then shows its address and announces itself", async () => {
  const { invoke, calls } = backend();
  const host = element();
  wireMusicControlApi({ invoke, host });
  await settle();
  const [row] = host.children,
    [copy, actions] = row.children,
    [text, , address] = copy.children,
    [overlayButton, copyButton, renew, toggle] = actions.children;
  assert.equal(text.textContent, t("Local control API: off"));
  assert.equal(toggle.textContent, t("Turn on"));
  assert.equal(copyButton.hidden, true);
  assert.equal(renew.hidden, true);
  assert.equal(overlayButton.hidden, true);
  assert.equal(controlApiRunning(), false);
  await toggle.handlers.click();
  assert.deepEqual(calls.at(-1), ["music_control_api_set", { enabled: true }]);
  assert.equal(text.textContent, t("Local control API: on"));
  assert.equal(address.textContent, "http://127.0.0.1:17311/api/v1");
  assert.equal(copyButton.hidden, false);
  assert.equal(controlApiRunning(), true);
  assert.equal(events.at(-1).type, CONTROL_API_EVENT);
  assert.equal(events.at(-1).detail, true);
  await renew.handlers.click();
  assert.deepEqual(calls.at(-1), ["music_control_api_set", { enabled: true, renew: true }]);
  await toggle.handlers.click();
  assert.deepEqual(calls.at(-1), ["music_control_api_set", { enabled: false }]);
  assert.equal(controlApiRunning(), false);
  assert.equal(events.at(-1).detail, false);
});

test("the copied example carries the token only to the clipboard", async () => {
  const { invoke } = backend();
  const host = element();
  const copied = [];
  const notes = [];
  wireMusicControlApi({ invoke, host, clipboard: { writeText: async value => copied.push(value) }, notify: message => notes.push(message) });
  await settle();
  const [overlayButton, copyButton, , toggle] = host.children[0].children[1].children;
  await toggle.handlers.click();
  await copyButton.handlers.click();
  assert.equal(copied.length, 1);
  assert.ok(copied[0].includes(`Bearer ${TOKEN}`));
  assert.ok(copied[0].endsWith("/api/v1/next"));
  assert.ok(!notes.some(note => note.includes(TOKEN)));
  assert.equal(controlApiExample({ token: "x", url: "http://127.0.0.1:17311/api/v1" }), 'curl -X POST -H "Authorization: Bearer x" http://127.0.0.1:17311/api/v1/next');
  // The OBS link is the overlay page with the same token, also only on the clipboard.
  await overlayButton.handlers.click();
  assert.equal(copied.at(-1), `http://127.0.0.1:17311/overlay?token=${TOKEN}`);
  assert.ok(!notes.some(note => note.includes(TOKEN)));
  assert.equal(controlApiOverlay({ url: "http://127.0.0.1:17311/api/v1", token: "x" }), "http://127.0.0.1:17311/overlay?token=x");
});

test("a port taken by another program is reported instead of claiming the API is on", async () => {
  const host = element();
  const invoke = async () => ({ enabled: true, running: false, url: "", token: TOKEN, error: "The control API port is in use" });
  wireMusicControlApi({ invoke, host });
  await settle();
  const text = host.children[0].children[0].children[0];
  assert.equal(text.textContent, t("Local control API: {error}", { error: t("The control API port is in use") }));
  assert.equal(controlApiRunning(), false);
});
