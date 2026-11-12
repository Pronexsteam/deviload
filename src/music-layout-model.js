// Where each movable block of Devil Music may live. A block can only be dropped into one of its zones,
// so a saved layout can never put something where the page has no room for it.
export const LAYOUT_KEY = "deviload-music-layout";

export const LAYOUT_ZONES = Object.freeze({
  home: Object.freeze(["welcome", "quick", "moods"]),
  greeting: Object.freeze(["stats"]),
  sidebar: Object.freeze(["navigation", "playlists"]),
  dock: Object.freeze(["lyrics", "queue", "panel", "expand", "mini", "clip", "remote", "volume"]),
});

// Blocks that may also move to a zone other than the one they start in.
const ROAMING = Object.freeze({ stats: Object.freeze(["sidebar"]) });
// Blocks that may be hidden; navigation and playlists always stay so the page remains usable.
export const HIDEABLE = Object.freeze([
  "quick",
  "moods",
  "stats",
  "lyrics",
  "queue",
  "panel",
  "expand",
  "clip",
  "mini",
  "remote",
  "volume",
]);

const homeOf = id => Object.keys(LAYOUT_ZONES).find(zone => LAYOUT_ZONES[zone].includes(id)) || "";

export function layoutZonesFor(id) {
  const home = homeOf(id);
  return home ? [home, ...(ROAMING[id] || [])] : [];
}

export function defaultLayout() {
  return {
    swapped: false,
    hidden: [],
    zones: Object.fromEntries(Object.entries(LAYOUT_ZONES).map(([zone, items]) => [zone, [...items]])),
  };
}

// Keeps known blocks in allowed zones, drops duplicates, and returns missing ones to where they start.
export function normalizeLayout(value) {
  const source = value && typeof value === "object" ? value : {};
  const saved = source.zones && typeof source.zones === "object" ? source.zones : {};
  const seen = new Set();
  const zones = {};
  for (const zone of Object.keys(LAYOUT_ZONES)) {
    const list = Array.isArray(saved[zone]) ? saved[zone] : [];
    zones[zone] = [];
    for (const id of list) {
      if (typeof id !== "string" || seen.has(id) || !layoutZonesFor(id).includes(zone)) continue;
      seen.add(id);
      zones[zone].push(id);
    }
  }
  for (const [zone, items] of Object.entries(LAYOUT_ZONES)) {
    items.forEach((id, index) => {
      if (seen.has(id)) return;
      seen.add(id);
      // Slot a returning block back near its usual place among the blocks that are still here.
      const after = items
        .slice(0, index)
        .filter(other => zones[zone].includes(other))
        .pop();
      zones[zone].splice(after ? zones[zone].indexOf(after) + 1 : 0, 0, id);
    });
  }
  const hidden = Array.isArray(source.hidden)
    ? [...new Set(source.hidden.filter(id => HIDEABLE.includes(id)))]
    : [];
  return { swapped: source.swapped === true, hidden, zones };
}

// Moves [id] to [index] in [zone]; a zone the block does not belong to leaves the layout unchanged.
export function moveLayoutItem(layout, id, zone, index) {
  const current = normalizeLayout(layout);
  if (!layoutZonesFor(id).includes(zone)) return current;
  const zones = Object.fromEntries(
    Object.entries(current.zones).map(([key, items]) => [key, items.filter(item => item !== id)]),
  );
  const target = zones[zone];
  target.splice(Math.max(0, Math.min(target.length, Math.round(Number(index) || 0))), 0, id);
  return normalizeLayout({ ...current, zones });
}

export function swapLayoutPanels(layout) {
  const current = normalizeLayout(layout);
  return { ...current, swapped: !current.swapped };
}

export function toggleLayoutHidden(layout, id) {
  const current = normalizeLayout(layout);
  if (!HIDEABLE.includes(id)) return current;
  const hidden = current.hidden.includes(id)
    ? current.hidden.filter(item => item !== id)
    : [...current.hidden, id];
  return normalizeLayout({ ...current, hidden });
}

export function isDefaultLayout(layout) {
  return JSON.stringify(normalizeLayout(layout)) === JSON.stringify(defaultLayout());
}

export function readLayout(storage = globalThis.localStorage) {
  try {
    return normalizeLayout(JSON.parse(storage?.getItem(LAYOUT_KEY) || "null"));
  } catch {
    return defaultLayout();
  }
}

export function saveLayout(layout, storage = globalThis.localStorage) {
  try {
    if (isDefaultLayout(layout)) storage?.removeItem(LAYOUT_KEY);
    else storage?.setItem(LAYOUT_KEY, JSON.stringify(normalizeLayout(layout)));
  } catch {
    /* Layout preferences are optional. */
  }
}
