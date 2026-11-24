// The highlight of app-glass.css follows the pointer: one listener for the whole app tells only the element
// under the cursor where the light falls, at most once a frame. Devil Music has its own glass and is skipped.
const TARGETS =
  "button.outline, button.quiet, button.primary, summary.outline, .library-more > summary, .media-library-item, .library .job, .convert-presets button";

export function wireAppGlass(root = document) {
  let target = null,
    x = 0,
    y = 0,
    frame = 0;
  const paint = () => {
    frame = 0;
    if (!target?.isConnected) return;
    const box = target.getBoundingClientRect();
    target.style.setProperty("--glass-x", `${Math.round(x - box.left)}px`);
    target.style.setProperty("--glass-y", `${Math.round(y - box.top)}px`);
  };
  root.addEventListener(
    "pointermove",
    event => {
      const found = event.target instanceof Element ? event.target.closest(TARGETS) : null;
      if (!found || found.closest("#devil-music, .music-dock, [class*='music-']:is(dialog)")) {
        target = null;
        return;
      }
      target = found;
      x = event.clientX;
      y = event.clientY;
      if (!frame) frame = requestAnimationFrame(paint);
    },
    { passive: true },
  );
}
