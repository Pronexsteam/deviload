// The Devil Music ghost beside the greeting. Loops: it floats on its own (idle), vibes while music plays
// (listening), keeps busy while a song downloads (working) and dozes when nothing happens for a while (sleep).
// One-shots play once and return to the loop: an entrance (appear), a hop when a download is saved (happy), a
// smitten look on a like, a glance when the song changes, waking up, and shoving or being bumped by the library
// panel beside it (push, bump). On top of the clips it swells with the song's bass and leans toward the cursor.
// The clips are VP9 with alpha in assets/ghost; a clip that is missing is skipped.
import { markDecorative } from "./music-motion.js";

const LOOPS = ["idle", "listening", "working", "sleep"];
const SHOTS = ["appear", "happy", "push", "bump", "like", "trackchange", "wake"];

export function ghostClip(name) {
  return `assets/ghost/${name}.webm`;
}

// How far the ghost leans toward a point: up to 22° left/right and 14° up/down, less when the point is far away.
export function ghostLean(dx, dy) {
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance < 1) return { x: 0, y: 0 };
  const reach = Math.min(1, 900 / Math.max(distance, 300));
  return {
    y: Math.max(-22, Math.min(22, (dx / distance) * 22 * reach)),
    x: Math.max(-14, Math.min(14, (-dy / distance) * 14 * reach)),
  };
}

export function createMusicGhost({
  reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  onClick = () => {},
} = {}) {
  const node = document.createElement("div"),
    body = document.createElement("div");
  node.className = "music-ghost";
  node.setAttribute("aria-hidden", "true");
  body.className = "music-ghost-body";
  node.append(body);
  // One video per clip, all loaded up front: switching only rewinds and shows a clip that is already decoded,
  // so a reaction never waits for a file in the middle of the moment it belongs to.
  const clips = new Map();
  for (const name of [...LOOPS, ...SHOTS]) {
    // Decorative: starting a song pauses every other media element on the page, but not these.
    const video = markDecorative(document.createElement("video"));
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.loop = LOOPS.includes(name);
    video.className = "music-ghost-clip";
    video.src = ghostClip(name);
    video.addEventListener("error", () => {
      // Not rendered yet: remembered, and the ghost stays in its loop.
      missing.add(name);
      if (shown === name) {
        shown = "";
        if (SHOTS.includes(name)) settle();
        else if (name !== "idle") show("idle");
      }
    });
    video.addEventListener("ended", () => {
      if (shown === name && SHOTS.includes(name)) settle();
    });
    body.append(video);
    clips.set(name, video);
  }
  const missing = new Set();
  let current = null,
    base = "idle",
    shot = "",
    shown = "";
  function settle() {
    shot = "";
    show(base);
  }
  function show(name) {
    if (name === shown) return;
    if (missing.has(name)) {
      if (SHOTS.includes(name)) settle();
      return;
    }
    shown = name;
    const next = clips.get(name),
      prev = current;
    next.currentTime = 0;
    const reveal = () => {
      if (shown !== name) return;
      next.classList.add("is-front");
      if (prev && prev !== next) {
        prev.classList.remove("is-front");
        setTimeout(() => {
          if (current !== prev) prev.pause();
        }, 260);
      }
      current = next;
    };
    if (reduced()) {
      // Still picture only: the clip's first frame.
      if (next.readyState >= 2) reveal();
      else next.addEventListener("loadeddata", reveal, { once: true });
      return;
    }
    next.play().catch(() => {});
    if (next.readyState >= 3) reveal();
    else next.addEventListener("playing", reveal, { once: true });
  }

  // Lean toward the cursor and swell with the bass, on one frame loop that sleeps when nothing changes.
  let lean = { x: 0, y: 0 },
    aim = { x: 0, y: 0 },
    swell = 0,
    bass = 0,
    frame = 0;
  function tick() {
    frame = 0;
    lean.x += (aim.x - lean.x) * 0.12;
    lean.y += (aim.y - lean.y) * 0.12;
    swell += (bass - swell) * (bass > swell ? 0.5 : 0.12);
    body.style.transform = `perspective(420px) rotateX(${lean.x.toFixed(2)}deg) rotateY(${lean.y.toFixed(2)}deg) scale(${(1 + swell * 0.07).toFixed(3)})`;
    body.style.setProperty("--ghost-glow", swell.toFixed(3));
    const moving =
      Math.abs(aim.x - lean.x) + Math.abs(aim.y - lean.y) > 0.05 || Math.abs(bass - swell) > 0.004;
    if (moving) frame = requestAnimationFrame(tick);
  }
  const wake = () => {
    if (!frame && !reduced()) frame = requestAnimationFrame(tick);
  };
  const follow = event => {
    if (!node.isConnected || !node.getClientRects().length) return;
    const box = node.getBoundingClientRect();
    aim = ghostLean(event.clientX - (box.left + box.width / 2), event.clientY - (box.top + box.height / 2));
    wake();
  };
  addEventListener("pointermove", follow, { passive: true });
  document.documentElement.addEventListener("pointerleave", () => {
    aim = { x: 0, y: 0 };
    wake();
  });
  node.addEventListener("click", () => onClick());

  return {
    node,
    // The loop it settles into: idle, listening, working or sleep.
    setBase(name) {
      if (!LOOPS.includes(name) || name === base) return;
      const waking = base === "sleep";
      base = name;
      if (waking && !shot) {
        shot = "wake";
        shown = "";
        show("wake");
      } else if (!shot) show(base);
    },
    get base() {
      return base;
    },
    // A one-shot that plays once and then returns to the loop.
    play(name) {
      if (!SHOTS.includes(name)) return;
      shot = name;
      shown = "";
      show(name);
    },
    // Goes over to a control and leans on it: a small wind-up away, a glide that stops with its side against the
    // control, the push landing at `impact` ms (the control dips, a ripple spreads from the contact point), a short
    // hold, and a springy glide home.
    shove(control, { impact = 220, onImpact = () => {} } = {}) {
      const from = node.getBoundingClientRect(),
        to = control.getBoundingClientRect();
      const dx = to.left + to.width / 2 - (from.left + from.width / 2),
        dy = to.top + to.height / 2 - (from.top + from.height / 2),
        distance = Math.hypot(dx, dy) || 1;
      const reach = Math.max(0, distance - from.width * 0.4),
        x = (dx / distance) * reach,
        y = (dy / distance) * reach;
      const total = impact + 640,
        at = impact / total;
      // On the way it crosses into the panel, past the edge of the scrolling content that would clip it: for the
      // trip it floats above the page, and a placeholder keeps its place in the greeting.
      const hold = document.createElement("div");
      hold.className = "music-ghost music-ghost-hold";
      node.before(hold);
      Object.assign(node.style, {
        position: "fixed",
        left: `${from.left}px`,
        top: `${from.top}px`,
        margin: "0",
        zIndex: "400",
      });
      const home = () => {
        for (const key of ["position", "left", "top", "margin", "zIndex"]) node.style[key] = "";
        hold.remove();
      };
      if (reduced()) {
        setTimeout(home, total);
      } else {
        // Out to the control: a wind-up, then the glide that lands on it.
        const out = node.animate(
          [
            { translate: "0 0", easing: "cubic-bezier(.45,0,.55,1)" },
            { translate: `${-x * 0.07}px ${-y * 0.07}px`, offset: 0.32, easing: "cubic-bezier(.6,0,.15,1)" },
            { translate: `${x}px ${y}px` },
          ],
          { duration: impact, fill: "forwards" },
        );
        // And back: the panel it pushed may move its home (the greeting slides over as the library folds), so it
        // glides to wherever the placeholder is on each frame, with a little overshoot.
        setTimeout(() => {
          out.cancel();
          node.style.translate = `${x}px ${y}px`;
          const start = performance.now(),
            back = 620;
          const ease = t => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
          const step = now => {
            const t = Math.min(1, (now - start) / back),
              place = hold.getBoundingClientRect(),
              tx = place.left - from.left,
              ty = place.top - from.top,
              p = t < 0.18 ? 0 : ease((t - 0.18) / 0.82);
            node.style.translate = `${x + (tx - x) * p}px ${y + (ty - y) * p}px`;
            if (t < 1) requestAnimationFrame(step);
            else {
              node.style.translate = "";
              home();
            }
          };
          requestAnimationFrame(step);
        }, impact);
      }
      setTimeout(() => {
        if (!reduced()) {
          control.animate([{ scale: 1 }, { scale: 0.84 }, { scale: 1 }], {
            duration: 280,
            easing: "ease-out",
          });
          const ripple = document.createElement("span");
          ripple.className = "music-ghost-ripple";
          ripple.style.left = `${to.left + to.width / 2 - (dx / distance) * to.width * 0.35}px`;
          ripple.style.top = `${to.top + to.height / 2 - (dy / distance) * to.height * 0.35}px`;
          document.body.append(ripple);
          ripple
            .animate(
              [
                { scale: 0.2, opacity: 0.9 },
                { scale: 2.6, opacity: 0 },
              ],
              { duration: 520, easing: "cubic-bezier(.2,.8,.3,1)" },
            )
            .finished.finally(() => ripple.remove());
        }
        onImpact();
      }, impact);
    },
    // Knocked aside by something arriving from the left: a jump away and a springy return.
    knock() {
      if (reduced()) return;
      node.animate(
        [
          { translate: "0 0", easing: "cubic-bezier(.15,.9,.3,1)" },
          { translate: "22px -8px", offset: 0.22, easing: "cubic-bezier(.4,0,.6,1)" },
          { translate: "-4px 2px", offset: 0.55, easing: "cubic-bezier(.3,1.4,.5,1)" },
          { translate: "0 0" },
        ],
        { duration: 820 },
      );
    },
    // The bass of the song playing, 0 to 1.
    pulse(level) {
      bass = Math.max(0, Math.min(1, Number(level) || 0));
      wake();
    },
  };
}
