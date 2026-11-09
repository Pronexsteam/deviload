import test from "node:test";
import assert from "node:assert/strict";
import {defaultLayout,normalizeLayout,moveLayoutItem,swapLayoutPanels,toggleLayoutHidden,isDefaultLayout,layoutZonesFor,readLayout,saveLayout,LAYOUT_KEY} from "../src/music-layout-model.js";

const memory=()=>{const map=new Map();return {getItem:key=>map.has(key)?map.get(key):null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key),map};};

test("blocks only move into the zones they belong to", () => {
  assert.deepEqual(layoutZonesFor("stats"), ["greeting", "sidebar"]);
  assert.deepEqual(layoutZonesFor("queue"), ["dock"]);
  assert.deepEqual(layoutZonesFor("nothing"), []);
  const moved = moveLayoutItem(defaultLayout(), "volume", "dock", 0);
  assert.deepEqual(moved.zones.dock.slice(0, 2), ["volume", "lyrics"]);
  const refused = moveLayoutItem(defaultLayout(), "queue", "home", 0);
  assert.deepEqual(refused, defaultLayout());
  const roamed = moveLayoutItem(defaultLayout(), "stats", "sidebar", 1);
  assert.deepEqual(roamed.zones.sidebar, ["navigation", "stats", "playlists"]);
  assert.deepEqual(roamed.zones.greeting, []);
});

test("a damaged or old saved layout is repaired", () => {
  const repaired = normalizeLayout({swapped: "yes", zones: {home: ["moods", "moods", "queue", 5, "welcome"], dock: ["volume"], sidebar: ["stats"]}});
  assert.equal(repaired.swapped, false);
  assert.deepEqual(repaired.zones.home, ["moods", "welcome", "quick"]);
  assert.deepEqual(repaired.zones.sidebar, ["navigation", "playlists", "stats"]);
  assert.deepEqual(repaired.zones.greeting, []);
  assert.equal(repaired.zones.dock.at(-1), "volume");
  assert.equal(new Set(repaired.zones.dock).size, 8);
  assert.deepEqual(normalizeLayout(null), defaultLayout());
});

test("swapping panels and reset are remembered", () => {
  const storage = memory();
  assert.deepEqual(readLayout(storage), defaultLayout());
  const changed = swapLayoutPanels(moveLayoutItem(defaultLayout(), "moods", "home", 0));
  assert.equal(isDefaultLayout(changed), false);
  saveLayout(changed, storage);
  assert.deepEqual(readLayout(storage), changed);
  saveLayout(defaultLayout(), storage);
  assert.equal(storage.map.has(LAYOUT_KEY), false);
  storage.setItem(LAYOUT_KEY, "{broken");
  assert.deepEqual(readLayout(storage), defaultLayout());
});

test("optional blocks can be hidden and shown again, essential ones cannot", () => {
  const hidden = toggleLayoutHidden(toggleLayoutHidden(defaultLayout(), "clip"), "navigation");
  assert.deepEqual(hidden.hidden, ["clip"]);
  assert.equal(isDefaultLayout(hidden), false);
  assert.deepEqual(toggleLayoutHidden(hidden, "clip"), defaultLayout());
  assert.deepEqual(normalizeLayout({hidden: ["moods", "moods", "playlists", 3]}).hidden, ["moods"]);
});
