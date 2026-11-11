// Player buttons shrink while pressed. A press near the edge of one used to end outside the shrunken button,
// and the browser then dropped the click: the orb looked pressed but nothing happened. The pressed button
// now captures the pointer, so the release still belongs to it. Moving clearly off the button, measured
// before it shrank, lets go, so a press can still be cancelled the usual way.
export const PRESS_BUTTONS =
  ".music-icon-button, .music-play-button, .music-like, .music-transport-buttons > button, .music-dock-extras > button, .mini-controls > button";
const SLACK = 6;

export function keepPresses(root = globalThis.document, selector = PRESS_BUTTONS) {
  root?.addEventListener(
    "pointerdown",
    event => {
      const button = event.target?.closest?.(selector);
      if (!button || button.disabled || event.button !== 0 || event.pointerType === "touch") return;
      if (button.draggable || button.closest?.("[draggable='true']")) return;
      const box = button.getBoundingClientRect();
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
        return;
      }
      const away = move => {
        const outside =
          move.clientX < box.left - SLACK ||
          move.clientX > box.right + SLACK ||
          move.clientY < box.top - SLACK ||
          move.clientY > box.bottom + SLACK;
        if (!outside) return;
        try {
          button.releasePointerCapture(event.pointerId);
        } catch {
          /* Already released. */
        }
        done();
      };
      const done = () => {
        button.removeEventListener("pointermove", away);
        button.removeEventListener("lostpointercapture", done);
      };
      button.addEventListener("pointermove", away);
      button.addEventListener("lostpointercapture", done);
    },
    true,
  );
}
