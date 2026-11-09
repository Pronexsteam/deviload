// Windows, menus and floating panels open out of the point that opened them. The motion itself lives in
// ui-motion.css; this only tells each element where its origin is.
let last = null;
const FRESH_MS = 1500;
const PANELS = ".music-queue-panel,.music-track-options";

const remember = (x, y) => { last = {x, y, at: performance.now()}; };
addEventListener("pointerdown", event => remember(event.clientX, event.clientY), true);
addEventListener("keydown", event => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const target = document.activeElement;
  if (!(target instanceof Element) || target === document.body) return;
  const box = target.getBoundingClientRect();
  remember(box.left + box.width / 2, box.top + box.height / 2);
}, true);

// The origin may lie outside the element, so a window seems to come from its button; it is bounded so
// a far button only nudges the start position.
export function setMotionOrigin(node) {
  if (!(node instanceof HTMLElement) || !last || performance.now() - last.at > FRESH_MS) return;
  const box = node.getBoundingClientRect();
  if (!box.width || !box.height) return;
  const clamp = value => Math.min(160, Math.max(-60, value));
  const x = clamp((last.x - box.left) / box.width * 100), y = clamp((last.y - box.top) / box.height * 100);
  node.style.setProperty("--motion-origin", `${x.toFixed(1)}% ${y.toFixed(1)}%`);
}

// Dialogs: measure right after they open, before the first frame is painted.
for (const name of ["showModal", "show"]) {
  const original = HTMLDialogElement.prototype[name];
  if (typeof original !== "function") continue;
  HTMLDialogElement.prototype[name] = function (...args) {
    const result = original.apply(this, args);
    setMotionOrigin(this);
    return result;
  };
}

// Popovers report opening before they are laid out; the next frame comes before the first paint.
document.addEventListener("beforetoggle", event => {
  const node = event.target;
  if (event.newState !== "open" || !(node instanceof HTMLElement) || node.classList.contains("ui-tooltip")) return;
  requestAnimationFrame(() => setMotionOrigin(node));
}, true);

// Floating panels shown by removing their hidden attribute.
new MutationObserver(records => {
  for (const record of records) {
    const node = record.target;
    if (node instanceof HTMLElement && !node.hidden && node.matches(PANELS)) setMotionOrigin(node);
  }
}).observe(document.documentElement, {subtree: true, attributes: true, attributeFilter: ["hidden"]});

// While the window is being resized, decoration holds still: transitions and looping animations pause
// so each new size is drawn quickly, and resume as soon as the edge is let go.
let resizing=0;
addEventListener("resize",()=>{
  if(!resizing)document.documentElement.classList.add("is-resizing");
  clearTimeout(resizing);resizing=setTimeout(()=>{resizing=0;document.documentElement.classList.remove("is-resizing");},160);
});

// The area Windows paints before the page catches up takes the theme's background, not black.
const hex=value=>{const m=String(value).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);if(!m||m[4]==="0")return "";return "#"+[m[1],m[2],m[3]].map(n=>Number(n).toString(16).padStart(2,"0")).join("");};
function tone(){
  const invoke=window.__TAURI__?.core?.invoke;if(!invoke)return;
  const color=hex(getComputedStyle(document.body).backgroundColor)||hex(getComputedStyle(document.documentElement).backgroundColor);
  if(color)invoke("window_background",{color}).catch(()=>{});
}
document.addEventListener("deviload-theme-change",()=>requestAnimationFrame(tone));
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",tone,{once:true});else tone();
