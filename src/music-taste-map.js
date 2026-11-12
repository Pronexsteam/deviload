import { t } from "./i18n.js";
import { tasteGraph, seedPosition, settleStars, separateStars } from "./music-taste-map-model.js";
import { artworkCandidates } from "./music-artwork.js";

// The taste map as a small galaxy. Stars settle by themselves; the constellations beside it name the groups
// and light one up; a hover shows a card for the artist and a click opens the artist.
// Muted tints, as on a printed chart: they tell the groups apart without shouting.
const COLORS = ["#e3a2ab", "#a6b9e6", "#e2c999", "#a3d3bd", "#c2afe0", "#dfae92", "#9fcfdf", "#d6d29a"];
const FONT = 'Inter,"Segoe UI",-apple-system,BlinkMacSystemFont,sans-serif';
const AVATARS = 24;
const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

export function createTasteMap({ getData, onArtist = () => {}, motion = () => true }) {
  const box = make("div", "music-taste-map"),
    sky = make("div", "music-taste-map-sky"),
    canvas = make("canvas"),
    empty = make("p", "music-taste-map-empty"),
    card = make("div", "music-taste-map-card"),
    side = make("aside", "music-taste-map-side"),
    sideTitle = make("h3", "music-taste-map-side-title"),
    groupList = make("div", "music-taste-map-groups"),
    legend = make("div", "music-taste-map-legend");
  canvas.setAttribute("role", "img");
  canvas.tabIndex = 0;
  card.setAttribute("aria-hidden", "true");
  sky.append(canvas, card, empty);
  side.append(sideTitle, groupList, legend);
  box.append(sky, side);
  let stars = [],
    edges = [],
    groups = [],
    frame = 0,
    heat = 0,
    hover = null,
    focus = null,
    width = 0,
    height = 0,
    view = { x: 0, y: 0, w: 2, h: 2 };
  const dust = Array.from({ length: 160 }, (_, i) => ({
    x: ((i * 7919) % 997) / 997,
    y: ((i * 104729) % 991) / 991,
    r: 0.35 + ((i * 31) % 10) / 14,
    phase: i * 1.7,
  }));
  const resize = () => {
    const rect = canvas.getBoundingClientRect(),
      ratio = Math.min(2, devicePixelRatio || 1);
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.getContext("2d").setTransform(ratio, 0, 0, ratio, 0, 0);
  };
  const observer = new ResizeObserver(() => {
    resize();
    if (!frame) paint(performance.now());
  });
  const redraw = () => {
    if (!frame) paint(performance.now());
  };
  // Covers load once per address and redraw the map as they arrive; one that fails leaves its initial.
  const pictures = new Map();
  function picture(url) {
    if (!pictures.has(url)) {
      const img = new Image();
      img.decoding = "async";
      img.onload = redraw;
      img.src = url;
      pictures.set(url, img);
    }
    return pictures.get(url);
  }

  function build() {
    const graph = tasteGraph(getData());
    const most = Math.max(1, ...graph.nodes.map(node => node.weight));
    // The artists played most appear as their cover; the rest stay small points so the map stays readable.
    stars = graph.nodes.map((node, index) => {
      const share = Math.sqrt(node.weight / most),
        url = index < AVATARS ? artworkCandidates(node.image || "", 120)[0] : "";
      return {
        ...node,
        ...seedPosition(node.key, index, graph.nodes.length),
        size: url ? 11 + 13 * share : 1.8 + 3.4 * share,
        picture: url ? picture(url) : null,
        color: COLORS[node.group % COLORS.length],
        rank: index,
      };
    });
    const byKey = new Map(stars.map(star => [star.key, star])),
      strongest = Math.max(1, ...graph.links.map(link => link.weight));
    edges = graph.links.map(link => ({
      a: byKey.get(link.a),
      b: byKey.get(link.b),
      strength: link.weight / strongest,
    }));
    // Constellations: each named after its brightest artist, the biggest first. Lone stars are left out.
    const byGroup = new Map();
    for (const star of stars) {
      if (!byGroup.has(star.group)) byGroup.set(star.group, []);
      byGroup.get(star.group).push(star);
    }
    groups = [...byGroup]
      .map(([id, members]) => ({ id, members, color: members[0].color, lead: members[0] }))
      .filter(group => group.members.length > 1)
      .sort((a, b) => b.members.length - a.members.length)
      .slice(0, 6);
    heat = 0.12;
    focus = null;
    hover = null;
    view = { x: 0, y: 0, w: 2, h: 2 };
    canvas.setAttribute(
      "aria-label",
      t("Taste map: {artists}", {
        artists: stars
          .slice(0, 12)
          .map(star => star.name)
          .join(", "),
      }),
    );
    empty.textContent = t("Listen to a few artists and your map will appear here.");
    empty.hidden = stars.length >= 3;
    side.hidden = stars.length < 3;
    renderSide();
  }

  function renderSide() {
    sideTitle.textContent = t("Constellations");
    groupList.replaceChildren(
      ...groups.map(group => {
        const row = make("button", "music-taste-map-group");
        row.type = "button";
        row.style.setProperty("--group", group.color);
        row.setAttribute("aria-pressed", String(focus === group.id));
        const names = make("span", "music-taste-map-group-names");
        names.append(
          make("strong", "", t("Around {artist}", { artist: group.lead.name })),
          make(
            "small",
            "",
            group.members
              .slice(1, 4)
              .map(star => star.name)
              .join(", "),
          ),
        );
        row.append(
          make("i"),
          names,
          make("span", "music-taste-map-group-count", String(group.members.length)),
        );
        row.title = t("Artists: {count}", { count: group.members.length });
        row.addEventListener("click", () => {
          focus = focus === group.id ? null : group.id;
          renderSide();
          redraw();
        });
        row.addEventListener("pointerenter", () => {
          if (focus === null) {
            hoverGroup = group.id;
            redraw();
          }
        });
        row.addEventListener("pointerleave", () => {
          hoverGroup = null;
          redraw();
        });
        return row;
      }),
    );
    legend.replaceChildren(
      make("span", "music-taste-map-legend-size", t("Bigger star — more listening")),
      make("span", "music-taste-map-legend-line", t("Line — sung together or played in a row")),
    );
  }
  let hoverGroup = null;

  function fit() {
    if (!stars.length) return;
    const xs = stars.map(star => star.x),
      ys = stars.map(star => star.y),
      target = {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
        w: Math.max(0.4, Math.max(...xs) - Math.min(...xs)),
        h: Math.max(0.4, Math.max(...ys) - Math.min(...ys)),
      };
    for (const key of ["x", "y", "w", "h"]) view[key] += (target[key] - view[key]) * 0.25;
  }
  const place = star => ({
    x: width / 2 + ((star.x - view.x) / view.w) * (width - 130),
    y: height / 2 + ((star.y - view.y) / view.h) * (height - 100) - 6,
  });

  function paint() {
    const ctx = canvas.getContext("2d"),
      lit = focus ?? hoverGroup,
      near = hover
        ? new Set([hover, ...edges.filter(e => e.a === hover || e.b === hover).flatMap(e => [e.a, e.b])])
        : null;
    const shown = star => (near ? near.has(star) : lit === null || star.group === lit);
    ctx.clearRect(0, 0, width, height);
    // A star chart's grid: rings and bearings around the middle, barely there.
    const cx = width / 2,
      cy = height / 2,
      reach = Math.hypot(width, height) / 2;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.045;
    for (let ring = 1; ring <= 4; ring++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (ring / 4) * reach * 0.82, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.03;
    for (let bearing = 0; bearing < 12; bearing++) {
      const angle = (bearing / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach);
      ctx.stroke();
    }
    // Faint background stars.
    ctx.fillStyle = "#fff";
    for (const speck of dust) {
      ctx.globalAlpha = 0.14 + (speck.phase % 1) * 0.16;
      ctx.fillRect(speck.x * width, speck.y * height, speck.r, speck.r);
    }
    // Links: straight hairlines, brighter around the star under the pointer.
    for (const edge of edges) {
      const a = place(edge.a),
        b = place(edge.b),
        on = shown(edge.a) && shown(edge.b),
        k = Math.min(edge.a.appear ?? 1, edge.b.appear ?? 1) ** 3;
      if (k < 0.01) continue;
      ctx.globalAlpha = (on ? (hover ? 0.55 : 0.08 + edge.strength * 0.16) : 0.025) * k;
      ctx.strokeStyle = hover && on ? "#fff" : "#dfe3f0";
      ctx.lineWidth = hover && on ? 1 : 0.75;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    // Stars: a crisp point in a muted tint with a faint halo; the brightest carry a thin ring.
    for (const star of stars) {
      const k = star.appear ?? 1;
      if (k < 0.01) continue;
      const { x, y } = place(star),
        on = shown(star),
        r = star.size * (star === hover ? (star.picture ? 1.12 : 1.25) : 1) * (0.55 + 0.45 * k);
      // An artist with a cover: a round picture with a hairline in its constellation's tint.
      if (star.picture) {
        ctx.globalAlpha = (on ? 1 : 0.18) * k;
        ctx.save();
        ctx.shadowColor = "rgb(0 0 0 / .7)";
        ctx.shadowBlur = 12;
        ctx.fillStyle = "#14161d";
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.clip();
        const img = star.picture;
        if (img.complete && img.naturalWidth) {
          const side = Math.min(img.naturalWidth, img.naturalHeight);
          ctx.drawImage(
            img,
            (img.naturalWidth - side) / 2,
            (img.naturalHeight - side) / 2,
            side,
            side,
            x - r,
            y - r,
            r * 2,
            r * 2,
          );
        } else {
          ctx.fillStyle = star.color + "40";
          ctx.fillRect(x - r, y - r, r * 2, r * 2);
          ctx.fillStyle = "#fff";
          ctx.font = `650 ${Math.round(r * 0.9)}px ${FONT}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(star.name.charAt(0).toUpperCase(), x, y + 1);
        }
        ctx.restore();
        ctx.globalAlpha = (on ? (star === hover ? 1 : 0.85) : 0.15) * k;
        ctx.strokeStyle = star === hover ? "#fff" : star.color;
        ctx.lineWidth = star === hover ? 2 : 1.4;
        ctx.beginPath();
        ctx.arc(x, y, r + 1, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
      ctx.globalAlpha = (on ? 0.22 : 0.05) * k;
      const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
      halo.addColorStop(0, star.color);
      halo.addColorStop(1, star.color + "00");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = (on ? 1 : 0.22) * k;
      ctx.fillStyle = star.color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.globalAlpha = (on ? 0.85 : 0.2) * k;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.8, r * 0.45), 0, Math.PI * 2);
      ctx.fill();
      if (star.rank < 6 || star === hover) {
        ctx.globalAlpha = (on ? (star === hover ? 0.9 : 0.32) : 0.08) * k;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(x, y, r + 4.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // Names beside the stars, as on a chart; the brightest first, a name that would collide moves to the
    // other side or is left out.
    ctx.textBaseline = "middle";
    const taken = stars.map(star => {
      const { x, y } = place(star);
      return { x1: x - star.size - 2, x2: x + star.size + 2, y1: y - star.size - 2, y2: y + star.size + 2 };
    });
    const free = box =>
      box.x1 > 2 &&
      box.x2 < width - 2 &&
      box.y1 > 2 &&
      box.y2 < height - 2 &&
      taken.every(o => box.x2 < o.x1 || box.x1 > o.x2 || box.y2 < o.y1 || box.y1 > o.y2);
    const order = hover ? [hover, ...stars.filter(star => star !== hover)] : stars;
    for (const star of order) {
      const on = shown(star),
        k = Math.max(0, ((star.appear ?? 1) - 0.75) / 0.25);
      if (k <= 0) continue;
      if (star !== hover && (!on || (star.rank >= 24 && lit === null && !near))) continue;
      const { x, y } = place(star),
        major = star.rank < 6 || star === hover;
      ctx.font = `${major ? 600 : 500} ${major ? 12 : 11}px ${FONT}`;
      const w = ctx.measureText(star.name).width,
        offset = star.size + (major ? 9 : 6),
        right = { x1: x + offset, x2: x + offset + w, y1: y - 7, y2: y + 7 },
        left = { x1: x - offset - w, x2: x - offset, y1: y - 7, y2: y + 7 },
        below = { x1: x - w / 2, x2: x + w / 2, y1: y + star.size + 5, y2: y + star.size + 19 },
        above = { x1: x - w / 2, x2: x + w / 2, y1: y - star.size - 19, y2: y - star.size - 5 };
      // The very brightest are always named; below their cover is their place of last resort.
      const spot =
        star === hover ? right : ([right, left, below, above].find(free) ?? (star.rank < 3 ? below : null));
      if (!spot) continue;
      taken.push(spot);
      ctx.globalAlpha = (star === hover ? 1 : major ? 0.92 : 0.55) * k;
      ctx.fillStyle = "#fff";
      ctx.textAlign = "left";
      // Over a busy patch, a name gets a soft dark backing so it can still be read.
      ctx.shadowColor = "rgb(0 0 0 / .9)";
      ctx.shadowBlur = 6;
      ctx.fillText(star.name, spot.x1, (spot.y1 + spot.y2) / 2);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
    placeCard();
  }

  // The card beside the star under the pointer: who, how often, which constellation, and what a click does.
  function placeCard() {
    if (!hover) {
      card.classList.remove("is-shown");
      return;
    }
    const { x, y } = place(hover),
      group = groups.find(item => item.id === hover.group);
    card.style.setProperty("--group", hover.color);
    card.replaceChildren(
      make("strong", "", hover.name),
      make("span", "", t("Listens: {count}", { count: Math.max(1, Math.round(hover.weight)) })),
      ...(group && group.lead !== hover
        ? [make("span", "", t("Around {artist}", { artist: group.lead.name }))]
        : []),
      make("small", "", t("Click to open the artist")),
    );
    // Above and beside the star, so its own name below stays visible.
    const gap = hover.size + 16,
      right = x + gap + 190 < width;
    card.style.left = `${right ? x + gap : x - gap - 190}px`;
    card.style.top = `${Math.max(8, Math.min(height - 110, y - 96))}px`;
    card.classList.add("is-shown");
  }

  // Pixels per map unit, for keeping covers apart on screen.
  const unit = () => Math.max(1, Math.min((width - 130) / view.w, (height - 100) / view.h));
  // The layout is worked out before anything is drawn; then the stars drift out from the middle, the brightest
  // first, the links join them and the names come last. Nothing jumps or reshuffles on screen.
  let intro = 0;
  const STAGGER = 14,
    TRAVEL = 760;
  const ease = p => 1 - (1 - p) ** 3;
  function settleNow() {
    while (heat > 0.001) heat = settleStars(stars, edges, heat);
    for (let i = 0; i < 160; i++) {
      fit();
      separateStars(stars, place, unit());
    }
    for (const star of stars) {
      star.fx = star.x;
      star.fy = star.y;
    }
  }
  function loop(now) {
    let busy = false;
    if (intro) {
      const elapsed = now - intro;
      for (const star of stars) {
        const p = Math.max(0, Math.min(1, (elapsed - star.rank * STAGGER) / TRAVEL)),
          e = ease(p);
        star.appear = p;
        star.x = view.x + (star.fx - view.x) * e;
        star.y = view.y + (star.fy - view.y) * e;
      }
      busy = elapsed < stars.length * STAGGER + TRAVEL + 400;
      if (!busy) {
        intro = 0;
        for (const star of stars) {
          star.appear = 1;
          star.x = star.fx;
          star.y = star.fy;
        }
      }
    }
    paint(now);
    frame = busy ? requestAnimationFrame(loop) : 0;
  }
  function pick(event) {
    const rect = canvas.getBoundingClientRect(),
      x = event.clientX - rect.left,
      y = event.clientY - rect.top;
    let best = null,
      distance = Infinity;
    for (const star of stars) {
      const at = place(star),
        d = Math.hypot(at.x - x, at.y - y);
      if (d < Math.max(12, star.size + 8) && d < distance) {
        best = star;
        distance = d;
      }
    }
    return best;
  }
  canvas.addEventListener("pointermove", event => {
    const star = pick(event);
    if (star === hover) return;
    hover = star;
    canvas.style.cursor = star ? "pointer" : "";
    redraw();
  });
  canvas.addEventListener("pointerleave", () => {
    hover = null;
    redraw();
  });
  canvas.addEventListener("click", event => {
    const star = pick(event);
    if (star) onArtist(star.name);
    else if (focus !== null) {
      focus = null;
      renderSide();
      redraw();
    }
  });
  // Keyboard: the arrows walk through the stars by size, Enter opens one.
  canvas.addEventListener("keydown", event => {
    if (!stars.length) return;
    const index = hover ? stars.indexOf(hover) : -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") hover = stars[(index + 1) % stars.length];
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      hover = stars[(index - 1 + stars.length) % stars.length];
    else if (event.key === "Enter" && hover) onArtist(hover.name);
    else if (event.key === "Escape" && hover) hover = null;
    else return;
    event.preventDefault();
    event.stopPropagation();
    redraw();
  });
  return {
    element: box,
    mount(host) {
      host.append(box);
      build();
      observer.observe(canvas);
      resize();
      settleNow();
      intro = motion() ? performance.now() : 0;
      for (const star of stars) star.appear = intro ? 0 : 1;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(loop);
    },
    unmount() {
      cancelAnimationFrame(frame);
      frame = 0;
      observer.disconnect();
      box.remove();
    },
  };
}
