import { createLean } from "./music-lean.js";
// The play orb: its light follows the pointer, a press sends out a ripple, the play and pause symbols
// blend into each other, and its glow breathes with the bass when the Ambient analysis is running.
// Only the system's "reduce motion" setting stills the player; the app's calm mode is for the downloader.
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function wireGlassOrb(button, { host: hostNode = null } = {}) {
  if (!button) return { energy() {} };
  let energy = 0,
    shown = 0;
  const orbLean = createLean(
    (x, y, settled) => {
      if (settled && !x && !y) {
        button.style.removeProperty("--mag-x");
        button.style.removeProperty("--mag-y");
        return;
      }
      button.style.setProperty("--mag-x", `${x.toFixed(2)}px`);
      button.style.setProperty("--mag-y", `${y.toFixed(2)}px`);
    },
    { stiffness: 0.08, damping: 0.62 },
  );
  // The bass level is set on the whole transport, so the timeline's glow can breathe with the orb.
  const host = () => hostNode || button.closest(".music-transport") || button;
  button.addEventListener("pointermove", event => {
    const box = button.getBoundingClientRect();
    button.style.setProperty("--orb-x", `${Math.round(((event.clientX - box.left) / box.width) * 100)}%`);
    button.style.setProperty("--orb-y", `${Math.round(((event.clientY - box.top) / box.height) * 100)}%`);
    // The orb leans a little towards the pointer, measured from where it rests: measuring from the moved
    // (and bass-scaled) orb would feed its own movement back and make it shake.
    const size = button.offsetWidth || box.width,
      cx = box.left + box.width / 2 - orbLean.x,
      cy = box.top + box.height / 2 - orbLean.y;
    orbLean.to(
      Math.max(-0.5, Math.min(0.5, (event.clientX - cx) / size)) * 3,
      Math.max(-0.5, Math.min(0.5, (event.clientY - cy) / size)) * 3,
    );
  });
  button.addEventListener("pointerleave", () => {
    button.style.removeProperty("--orb-x");
    button.style.removeProperty("--orb-y");
    orbLean.release();
  });
  // A press wobbles the orb like a drop of liquid.
  button.addEventListener("click", () => {
    if (still()) return;
    button.animate(
      [
        { transform: "scale(1,1)" },
        { transform: "scale(1.14,.84)", offset: 0.22 },
        { transform: "scale(.9,1.1)", offset: 0.46 },
        { transform: "scale(1.05,.96)", offset: 0.7 },
        { transform: "scale(1,1)" },
      ],
      { duration: 620, easing: "ease-out", composite: "add" },
    );
  });
  button.addEventListener("pointerdown", () => {
    if (still()) return;
    const ring = document.createElement("span");
    ring.className = "music-orb-ripple";
    ring.setAttribute("aria-hidden", "true");
    button.append(ring);
    ring.addEventListener("animationend", () => ring.remove(), { once: true });
  });
  // The symbol is swapped by the player; fading it around the swap turns the change into a blend.
  new MutationObserver(records => {
    if (still() || !records.some(record => record.attributeName === "data-icon")) return;
    button.classList.add("is-morphing");
    requestAnimationFrame(() => requestAnimationFrame(() => button.classList.remove("is-morphing")));
  }).observe(button, { subtree: true, attributes: true, attributeFilter: ["data-icon"] });
  return {
    // Bass level 0..1; rises quickly and settles slowly so the orb breathes rather than flickers.
    energy(level) {
      if (still()) {
        if (shown) {
          shown = 0;
          host().style.removeProperty("--orb-energy");
        }
        return;
      }
      const value = Math.max(0, Math.min(1, Number(level) || 0));
      energy = value > energy ? energy * 0.6 + value * 0.4 : energy * 0.94 + value * 0.06;
      const rounded = Math.round(energy * 50) / 50;
      if (rounded === shown) return;
      shown = rounded;
      host().style.setProperty("--orb-energy", String(rounded));
    },
  };
}

// Each player button answers a press in its own way: skips slide the symbol out and back in their
// direction, repeat turns, shuffle twists, a like pops with a small burst, and switching a mode on
// sends out a ring. Animations run on the symbol (or the heart) so they never fight the button's own
// hover and press scale.
const SPRING = "cubic-bezier(.2,1.25,.3,1)";
const PLAYER = ".music-dock,.music-stage,.music-mini-page";
const BUTTONS = ".music-transport-buttons>button,.music-dock-extras>button,.music-like,.mini-controls>button";
function motionFor(icon) {
  if (/^skip-forward/.test(icon))
    return {
      frames: [
        { transform: "translateX(0)", opacity: 1 },
        { transform: "translateX(12px)", opacity: 0, offset: 0.38 },
        { transform: "translateX(-12px)", opacity: 0, offset: 0.4 },
        { transform: "translateX(0)", opacity: 1 },
      ],
      duration: 420,
      easing: "ease-out",
    };
  if (/^skip-back/.test(icon))
    return {
      frames: [
        { transform: "translateX(0)", opacity: 1 },
        { transform: "translateX(-12px)", opacity: 0, offset: 0.38 },
        { transform: "translateX(12px)", opacity: 0, offset: 0.4 },
        { transform: "translateX(0)", opacity: 1 },
      ],
      duration: 420,
      easing: "ease-out",
    };
  if (/^repeat/.test(icon))
    return {
      frames: [{ transform: "rotate(0)" }, { transform: "rotate(360deg)" }],
      duration: 560,
      easing: "cubic-bezier(.3,.9,.2,1)",
    };
  if (/^shuffle/.test(icon))
    return {
      frames: [
        { transform: "rotate(0) scaleX(1)" },
        { transform: "rotate(-14deg) scaleX(.86)", offset: 0.35 },
        { transform: "rotate(8deg) scaleX(1.06)", offset: 0.7 },
        { transform: "rotate(0) scaleX(1)" },
      ],
      duration: 480,
      easing: "ease-out",
    };
  return {
    frames: [
      { transform: "scale(1)" },
      { transform: "scale(.78)", offset: 0.3 },
      { transform: "scale(1.14)", offset: 0.68 },
      { transform: "scale(1)" },
    ],
    duration: 440,
    easing: SPRING,
  };
}
function burst(button) {
  const ring = document.createElement("span");
  ring.className = "music-like-burst";
  ring.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 8; index++) {
    const dot = document.createElement("i");
    dot.style.setProperty("--turn", `${index * 45}deg`);
    ring.append(dot);
  }
  button.append(ring);
  ring.addEventListener("animationend", () => ring.remove(), { once: true });
}
function ringOut(button) {
  const ring = document.createElement("span");
  ring.className = "music-mode-ring";
  ring.setAttribute("aria-hidden", "true");
  button.append(ring);
  ring.addEventListener("animationend", () => ring.remove(), { once: true });
}
export function wireGlassButtons(root = document) {
  // The glass catches the light where the pointer is; the symbol itself stays still.
  let lit = null,
    frame = 0,
    px = 0,
    py = 0;
  const paint = () => {
    frame = 0;
    if (!lit) return;
    const box = lit.getBoundingClientRect(),
      fx = (px - box.left) / box.width,
      fy = (py - box.top) / box.height;
    lit.style.setProperty("--bx", `${Math.round(fx * 100)}%`);
    lit.style.setProperty("--by", `${Math.round(fy * 100)}%`);
  };
  const clear = node => {
    if (!node) return;
    node.style.removeProperty("--bx");
    node.style.removeProperty("--by");
  };
  root.addEventListener("pointermove", event => {
    const button = event.target instanceof Element ? event.target.closest(BUTTONS) : null;
    const next =
      button && button.closest(PLAYER) && !button.classList.contains("music-play-button") ? button : null;
    if (next !== lit) {
      clear(lit);
      lit = next;
    }
    if (!lit) return;
    px = event.clientX;
    py = event.clientY;
    if (!frame) frame = requestAnimationFrame(paint);
  });
  root.addEventListener("click", event => {
    if (still() || !(event.target instanceof Element)) return;
    const button = event.target.closest(BUTTONS);
    if (
      !button ||
      !button.closest(PLAYER) ||
      button.classList.contains("music-play-button") ||
      button.disabled
    )
      return;
    const wasOn = button.getAttribute("aria-pressed") === "true";
    const icon = button.querySelector(".icon");
    const like = button.classList.contains("music-like");
    // The player updates the button in the same task; the outcome is read once it has.
    requestAnimationFrame(() => {
      const on = button.getAttribute("aria-pressed") === "true";
      if (like) {
        button.animate(
          [
            { transform: "scale(1)" },
            { transform: "scale(.7)", offset: 0.25 },
            { transform: "scale(1.3)", offset: 0.6 },
            { transform: "scale(1)" },
          ],
          { duration: 520, easing: SPRING },
        );
        if (on) burst(button);
        return;
      }
      const target = icon || button,
        { frames, duration, easing } = motionFor(icon?.dataset.icon || "");
      target.animate(frames, { duration, easing });
      if (on && !wasOn) ringOut(button);
    });
  });
}
