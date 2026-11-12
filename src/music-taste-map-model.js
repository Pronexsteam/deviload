// The taste map: artists from this device's listening as stars, sized by how much they were played, and
// joined when they sing together or were listened to one after another. Nothing leaves the device.
const SESSION_GAP = 45 * 60000;
const clean = value => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 60) : "");
const keyOf = name => name.normalize("NFKC").toLowerCase();
const artistsOf = item =>
  [...new Set((Array.isArray(item?.artists) ? item.artists : []).map(clean).filter(Boolean))].slice(0, 4);

export function tasteGraph({ entries = [], recent = [], maxNodes = 60, maxLinks = 160 } = {}) {
  const nodes = new Map(),
    links = new Map();
  // Each artist shows the cover of the song of theirs played most, preferring songs where they are named first.
  const add = (name, weight, image = "", lead = false) => {
    const key = keyOf(name);
    const node = nodes.get(key) || { key, name, weight: 0, image: "", imageWeight: 0 };
    node.weight += weight;
    const claim = weight * (lead ? 2 : 1);
    if (typeof image === "string" && image && claim > node.imageWeight) {
      node.image = image;
      node.imageWeight = claim;
    }
    nodes.set(key, node);
    return key;
  };
  const join = (a, b, weight) => {
    if (!a || !b || a === b) return;
    const id = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
    const link = links.get(id) || { a: a < b ? a : b, b: a < b ? b : a, weight: 0 };
    link.weight += weight;
    links.set(id, link);
  };
  const played = (Array.isArray(entries) ? entries : []).filter(
    entry => entry?.item && (entry.plays > 0 || entry.score > 0),
  );
  for (const entry of played) {
    const names = artistsOf(entry.item),
      weight = Math.max(1, Number(entry.plays) || 0);
    const keys = names.map((name, i) => add(name, weight / names.length, entry.item.image, i === 0));
    // Singing together is the strongest bond.
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) join(keys[i], keys[j], 2);
  }
  // Listened to one after another in the same sitting.
  const timed = played
    .filter(entry => Number.isFinite(entry.lastPlayed) && entry.lastPlayed > 0)
    .sort((a, b) => a.lastPlayed - b.lastPlayed);
  for (let i = 1; i < timed.length; i++)
    if (timed[i].lastPlayed - timed[i - 1].lastPlayed < SESSION_GAP) {
      const a = artistsOf(timed[i - 1].item)[0],
        b = artistsOf(timed[i].item)[0];
      if (a && b) join(keyOf(a), keyOf(b), 1);
    }
  const list = (Array.isArray(recent) ? recent : []).filter(item => item?.kind === "song" || item?.artists);
  for (let i = 0; i < list.length; i++) {
    const first = artistsOf(list[i])[0];
    if (first) add(first, 0.25, list[i].image, true);
    const next = artistsOf(list[i + 1])[0];
    if (first && next) join(keyOf(first), keyOf(next), 0.5);
  }
  const kept = [...nodes.values()].sort((a, b) => b.weight - a.weight).slice(0, maxNodes),
    allowed = new Set(kept.map(node => node.key));
  const edges = [...links.values()]
    .filter(link => allowed.has(link.a) && allowed.has(link.b))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxLinks);
  const group = tasteGroups(kept, edges);
  return {
    nodes: kept.map(({ imageWeight, ...node }) => ({ ...node, group: group.get(node.key) ?? 0 })),
    links: edges,
  };
}

// Pushes apart stars whose discs overlap, in pixels: [radius] and [place] give each star's size and screen
// position, [scale] turns pixels back into map units. Returns whether anything moved.
export function separateStars(stars, place, scale, gap = 6) {
  let moved = false;
  const at = stars.map(place);
  for (let i = 0; i < stars.length; i++)
    for (let j = i + 1; j < stars.length; j++) {
      const need = stars[i].size + stars[j].size + gap,
        x = at[j].x - at[i].x,
        y = at[j].y - at[i].y,
        d = Math.hypot(x, y) || 0.01;
      if (d >= need) continue;
      const push = ((need - d) / 2 / scale) * 0.9,
        ux = x / d,
        uy = y / d;
      stars[i].x -= ux * push;
      stars[i].y -= uy * push;
      stars[j].x += ux * push;
      stars[j].y += uy * push;
      at[i] = place(stars[i]);
      at[j] = place(stars[j]);
      moved = true;
    }
  return moved;
}

// Neighbourhoods by weighted label spreading: each artist takes the label its strongest neighbours share.
// Labels are numbered by size, so the biggest neighbourhood always gets the first colour.
export function tasteGroups(nodes, links) {
  const label = new Map(nodes.map((node, i) => [node.key, i])),
    around = new Map(nodes.map(node => [node.key, []]));
  for (const link of links) {
    around.get(link.a)?.push([link.b, link.weight]);
    around.get(link.b)?.push([link.a, link.weight]);
  }
  for (let round = 0; round < 12; round++) {
    let changed = false;
    for (const node of nodes) {
      const votes = new Map();
      for (const [other, weight] of around.get(node.key))
        votes.set(label.get(other), (votes.get(label.get(other)) || 0) + weight);
      let best = label.get(node.key),
        most = votes.get(best) || 0;
      for (const [value, weight] of votes)
        if (weight > most || (weight === most && value < best)) {
          best = value;
          most = weight;
        }
      if (best !== label.get(node.key)) {
        label.set(node.key, best);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const sizes = new Map();
  for (const value of label.values()) sizes.set(value, (sizes.get(value) || 0) + 1);
  const order = [...sizes].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([value]) => value);
  return new Map([...label].map(([key, value]) => [key, order.indexOf(value)]));
}

// A stable starting place for each artist, so the map looks the same each time it opens.
export function seedPosition(key, index, total) {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  const angle = ((hash >>> 0) / 4294967296) * Math.PI * 2,
    radius = 0.15 + 0.8 * Math.sqrt((index + 0.5) / Math.max(1, total));
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

// One step of a force layout in a square from -1 to 1 (Fruchterman and Reingold): every star pushes the others
// away, links pull, a light gravity keeps the galaxy round, and no star moves further than [heat]. Returns the
// cooler heat for the next step.
export function settleStars(stars, edges, heat) {
  const count = stars.length;
  if (!count) return 0;
  const k = Math.sqrt(4 / count) * 0.5;
  for (const star of stars) star.dx = star.dy = 0;
  for (let i = 0; i < count; i++)
    for (let j = i + 1; j < count; j++) {
      const a = stars[i],
        b = stars[j],
        x = a.x - b.x,
        y = a.y - b.y,
        d = Math.max(0.01, Math.hypot(x, y)),
        push = (k * k) / d;
      a.dx += (x / d) * push;
      a.dy += (y / d) * push;
      b.dx -= (x / d) * push;
      b.dy -= (y / d) * push;
    }
  for (const { a, b, strength = 1 } of edges) {
    const x = b.x - a.x,
      y = b.y - a.y,
      d = Math.max(0.01, Math.hypot(x, y)),
      pull = ((d * d) / k) * (0.3 + 0.7 * strength);
    a.dx += (x / d) * pull;
    a.dy += (y / d) * pull;
    b.dx -= (x / d) * pull;
    b.dy -= (y / d) * pull;
  }
  for (const star of stars) {
    star.dx -= star.x * 1.2;
    star.dy -= star.y * 1.2;
    const length = Math.hypot(star.dx, star.dy) || 1,
      move = Math.min(length, heat);
    star.x = Math.max(-1, Math.min(1, star.x + (star.dx / length) * move));
    star.y = Math.max(-1, Math.min(1, star.y + (star.dy / length) * move));
  }
  return heat * 0.97;
}
