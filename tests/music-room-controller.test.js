import test from "node:test";
import assert from "node:assert/strict";

// A tiny DOM: elements that hold children, text, attributes and click handlers.
const element = tag => {
  const node = { tag, children: [], handlers: {}, dataset: {}, attributes: {}, hidden: false, textContent: "", value: "", open: false };
  node.append = (...items) => node.children.push(...items);
  node.addEventListener = (name, fn) => (node.handlers[name] = fn);
  node.setAttribute = (key, value) => (node.attributes[key] = String(value));
  node.querySelector = name => node.children.find(child => child.tag === name) || null;
  node.showModal = () => (node.open = true);
  node.close = () => (node.open = false);
  node.focus = () => {};
  return node;
};
globalThis.document = { documentElement: { lang: "en" }, createElement: element, body: element("body") };
globalThis.window = { addEventListener() {} };
const intervals = [];
globalThis.setInterval = fn => intervals.push(fn);
const { createMusicRoom } = await import("../src/music-room-controller.js");
const { t } = await import("../src/i18n.js");
const button = (label, icon, action, cls = "") => {
  const node = element("button");
  node.title = label;
  node.className = cls;
  node.addEventListener("click", action);
  return node;
};
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const audio = { paused: true, playbackRate: 1, currentTime: 0, readyState: 4, duration: 200, pause() { this.paused = true; }, async play() { this.paused = false; } };
const packet = { state: { id: "dQw4w9WgXcQ", title: "Song", artists: ["Band"], position: 10, playing: true }, age_ms: 0, transport_ms: 0 };

function room(answer) {
  const calls = [],
    notes = [],
    left = [];
  const api = createMusicRoom({
    invoke: async (command, args) => {
      calls.push(command);
      return answer(command, args);
    },
    button,
    extras: element("div"),
    getState: () => packet.state,
    getAudio: () => audio,
    playTrack: async () => {},
    onEnter() {},
    onLeave: () => left.push(true),
    notify: (message, error) => notes.push([message, !!error]),
  });
  return { api, calls, notes, left, tick: () => intervals.at(-1)() };
}
const join = async api => {
  const dialog = document.body.children.at(-1);
  const choices = dialog.children.find(child => child.className === "music-room-choices");
  const guest = choices.children[1],
    row = guest.children.at(-1);
  row.children[0].value = "https://one-two.trycloudflare.com/#" + "a".repeat(64);
  await row.children[1].handlers.click();
};

test("a guest whose host closed the room leaves it, so their own music plays again", async () => {
  let ended = false;
  const { api, notes, left, tick } = room(command => {
    if (command === "music_room_poll") {
      if (ended) throw "The host closed the listening room.";
      return packet;
    }
  });
  await join(api);
  assert.equal(api.isGuest(), true);
  assert.equal(api.badge.hidden, false);
  assert.equal(api.quickClose.hidden, false);
  ended = true;
  await tick();
  await settle();
  assert.equal(api.isGuest(), false);
  assert.deepEqual(left, [true]);
  assert.equal(notes.at(-1)[0], t("The host closed the listening room. Your music is yours again."));
  assert.equal(api.badge.hidden, true);
  assert.equal(api.quickClose.hidden, true);
});

test("the host sees how many are listening and closes the room from the dock", async () => {
  let count = 0;
  const { api, calls, tick } = room(command => {
    if (command === "music_room_create") return "https://one-two.trycloudflare.com/#" + "b".repeat(64);
    if (command === "music_room_update") return { connected: count > 0, listeners: count };
  });
  const dialog = document.body.children.at(-1);
  const host = dialog.children.find(child => child.className === "music-room-choices").children[0];
  await host.children.at(-1).handlers.click();
  count = 2;
  await tick();
  assert.equal(api.badge.children.at(-1).textContent, "2");
  assert.equal(api.badge.title, t("Listening room: {count} connected", { count: 2 }));
  await api.quickClose.handlers.click();
  assert.equal(calls.at(-1), "music_room_stop");
  assert.equal(api.badge.hidden, true);
});
