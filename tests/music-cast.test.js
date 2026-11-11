import test from "node:test";
import assert from "node:assert/strict";

const element = tag => {
  const classes = new Set();
  const node = { tag, children: [], handlers: {}, attributes: {}, hidden: false, textContent: "", open: false };
  node.classList = { add: c => classes.add(c), remove: c => classes.delete(c) };
  node.append = (...items) => node.children.push(...items);
  node.replaceChildren = (...items) => (node.children = items);
  node.setAttribute = (k, v) => (node.attributes[k] = v);
  node.addEventListener = (name, fn) => (node.handlers[name] = fn);
  node.showModal = () => (node.open = true);
  node.close = () => (node.open = false);
  return node;
};
globalThis.document ??= { documentElement: { lang: "en" }, createElement: element, body: element("body") };
const { createMusicCast, isCasting, needsResync, DRIFT_SECONDS } = await import("../src/music-cast.js");
const { t } = await import("../src/i18n.js");
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function fakeDecks() {
  const make = () => ({ muted: false, paused: true, ended: false, currentTime: 12, volume: 0.5, currentSrc: "http://127.0.0.1:5000/a" });
  const nodes = [make(), make()],
    handlers = {};
  return {
    nodes,
    current: nodes[0],
    listen: (name, fn) => (handlers[name] = fn),
    fire: name => handlers[name]?.(),
  };
}
function setup(devices = [{ id: "cast:192.168.1.4:8009", name: "Kitchen", kind: "cast" }]) {
  const calls = [],
    notes = [];
  let status = { device: "Kitchen", state: "playing", position: 12, duration: 200, error: false };
  const invoke = async (command, args) => {
    calls.push([command, args]);
    if (command === "music_cast_devices") return devices;
    if (command === "music_cast_status") return status;
    return null;
  };
  const decks = fakeDecks();
  let tick = null;
  const button = (label, icon, fn) => {
    const node = element("button");
    node.textContent = label;
    node.handlers.click = fn;
    return node;
  };
  const cast = createMusicCast({
    invoke,
    button,
    decks,
    getState: () => ({ id: "dQw4w9WgXcQ", title: "Song", artist: "Band", image: "" }),
    notify: (message, error) => notes.push([message, !!error]),
    poll: fn => ((tick = fn), 1),
    stopPoll: () => (tick = null),
  });
  return { cast, calls, notes, decks, setStatus: value => (status = value), tick: () => tick?.() };
}

test("the device drifting far from the player here is asked to catch up, at most every ten seconds", () => {
  assert.ok(needsResync({ state: "playing", position: 10 }, 10 + DRIFT_SECONDS + 1, 20000, 0));
  assert.ok(!needsResync({ state: "playing", position: 10 }, 12, 20000, 0));
  assert.ok(!needsResync({ state: "paused", position: 10 }, 60, 20000, 0));
  assert.ok(!needsResync({ state: "playing", position: 10 }, 60, 20000, 15000));
});

test("casting silences the player here and mirrors play, pause, seeking and new songs", async () => {
  const { cast, calls, notes, decks, tick, setStatus } = setup();
  cast.open();
  await settle();
  const dialog = document.body.children.at(-1);
  const list = dialog.children[3];
  assert.equal(list.children.length, 1);
  await list.children[0].handlers.click();
  assert.deepEqual(calls.at(-1), ["music_cast_start", { device: "cast:192.168.1.4:8009", id: "dQw4w9WgXcQ", url: "http://127.0.0.1:5000/a", title: "Song", artist: "Band", image: "", position: 12, playing: false }]);
  assert.ok(isCasting());
  assert.ok(decks.nodes.every(node => node.muted));
  assert.equal(cast.badge.hidden, false);
  assert.equal(notes.at(-1)[0], t("Casting to {device}", { device: "Kitchen" }));

  decks.fire("play");
  assert.deepEqual(calls.at(-1), ["music_cast_control", { action: "play" }]);
  decks.fire("pause");
  assert.deepEqual(calls.at(-1), ["music_cast_control", { action: "pause" }]);
  decks.current.currentTime = 80;
  decks.fire("seeked");
  assert.deepEqual(calls.at(-1), ["music_cast_control", { action: "seek", value: 80 }]);
  // The next song: a new address on the player here goes to the device.
  decks.current.currentSrc = "http://127.0.0.1:5000/b";
  decks.current.currentTime = 0;
  decks.fire("loadedmetadata");
  await settle();
  assert.equal(calls.at(-1)[0], "music_cast_load");
  assert.equal(calls.at(-1)[1].url, "http://127.0.0.1:5000/b");
  // A muting change is not a volume change.
  const before = calls.length;
  decks.fire("volumechange");
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(calls.length, before);
  // The device is twelve seconds behind the new song here: it is asked to catch up.
  await tick();
  assert.equal(calls.at(-2)[0], "music_cast_status");
  assert.deepEqual(calls.at(-1), ["music_cast_control", { action: "seek", value: 0 }]);
  // In step, nothing more is sent.
  setStatus({ device: "Kitchen", state: "playing", position: 1, duration: 200, error: false });
  await tick();
  assert.equal(calls.at(-1)[0], "music_cast_status");
});

test("a device taken over by something else ends casting and brings the sound back", async () => {
  const { cast, calls, decks, setStatus, tick, notes } = setup();
  cast.open();
  await settle();
  await document.body.children.at(-1).children[3].children[0].handlers.click();
  assert.ok(isCasting());
  setStatus({ device: "Kitchen", state: "gone", position: 0, duration: 0, error: false });
  await tick();
  assert.ok(!isCasting());
  assert.ok(decks.nodes.every(node => !node.muted));
  assert.equal(cast.badge.hidden, true);
  assert.equal(notes.at(-1)[0], t("Casting to {device} ended.", { device: "Kitchen" }));
  assert.ok(!calls.some(([command, args]) => command === "music_cast_control" && args.action === "stop"));
});

test("no devices found explains where they must be", async () => {
  const { cast } = setup([]);
  cast.open();
  await settle();
  const state = document.body.children.at(-1).children[2];
  assert.equal(state.textContent, t("No TVs or speakers found. They must be on the same Wi-Fi as this computer."));
});
