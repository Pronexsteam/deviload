// Songs that would not play for a reason of their own (removed from YouTube, blocked in this region, an audio
// file that cannot be decoded). Lists show them faded with the reason on hover, so nobody has to click to find
// out. A song that plays again loses the mark, and marks are forgotten after two weeks: songs come back.
const KEY = "deviload-music-unavailable",
  LIFETIME = 14 * 24 * 60 * 60 * 1000,
  LIMIT = 500;

export function createUnavailableSongs({
  storage = globalThis.localStorage,
  now = () => Date.now(),
  root = () => globalThis.document,
  describe = reason => reason,
} = {}) {
  const songs = new Map();
  try {
    for (const [id, entry] of Object.entries(JSON.parse(storage?.getItem(KEY) || "{}")))
      if (typeof id === "string" && entry && now() - Number(entry.at) < LIFETIME)
        songs.set(id, { at: Number(entry.at), reason: String(entry.reason || "") });
  } catch {
    /* A damaged list starts empty. */
  }
  function save() {
    try {
      storage?.setItem(KEY, JSON.stringify(Object.fromEntries(songs)));
    } catch {
      /* Without storage the marks last for this session. */
    }
  }
  function flag(node, id) {
    if (!node) return;
    const entry = songs.get(String(id));
    node.classList.toggle("is-unavailable", !!entry);
    if (entry) node.title = describe(entry.reason);
    else if (node.dataset.unavailableTitle !== undefined) node.removeAttribute("title");
    if (entry) node.dataset.unavailableTitle = "";
    else delete node.dataset.unavailableTitle;
  }
  function update(id) {
    const document = root();
    if (!document?.querySelectorAll) return;
    const escaped = globalThis.CSS?.escape
      ? globalThis.CSS.escape(String(id))
      : String(id).replace(/"/g, '\\"');
    for (const node of document.querySelectorAll(`[data-track-id="${escaped}"]`)) flag(node, id);
  }
  return {
    has: id => songs.has(String(id)),
    reason: id => songs.get(String(id))?.reason || "",
    mark(id, reason = "") {
      if (!id) return;
      songs.delete(String(id));
      songs.set(String(id), { at: now(), reason });
      while (songs.size > LIMIT) songs.delete(songs.keys().next().value);
      save();
      update(id);
    },
    clear(id) {
      if (!songs.delete(String(id))) return;
      save();
      update(id);
    },
    flag,
  };
}
