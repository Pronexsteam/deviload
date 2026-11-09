// A soft spring that follows a target and settles back when let go, for things that lean towards the
// pointer. It runs only while moving and writes through [apply], so the browser never restarts a CSS
// transition on every pointer move.
const still = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function springStep(state, { stiffness = 0.12, damping = 0.74 } = {}) {
  const vx = (state.vx + (state.tx - state.x) * stiffness) * damping,
    vy = (state.vy + (state.ty - state.y) * stiffness) * damping;
  const x = state.x + vx,
    y = state.y + vy;
  const settled =
    Math.abs(state.tx - x) < 0.005 &&
    Math.abs(state.ty - y) < 0.005 &&
    Math.abs(vx) < 0.005 &&
    Math.abs(vy) < 0.005;
  return settled
    ? { ...state, x: state.tx, y: state.ty, vx: 0, vy: 0, settled: true }
    : { ...state, x, y, vx, vy, settled: false };
}

export function createLean(apply, options) {
  let state = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, settled: true },
    frame = 0;
  const step = () => {
    frame = 0;
    state = springStep(state, options);
    apply(state.x, state.y, state.settled);
    if (!state.settled) frame = requestAnimationFrame(step);
  };
  return {
    to(x, y) {
      if (still()) {
        x = 0;
        y = 0;
      }
      state = { ...state, tx: x, ty: y, settled: false };
      if (!frame) frame = requestAnimationFrame(step);
    },
    release() {
      this.to(0, 0);
    },
    // Where it is now, so callers can measure from the resting place rather than the moved one.
    get x() {
      return state.x;
    },
    get y() {
      return state.y;
    },
  };
}
