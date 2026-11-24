// DJ transitions: the end of the song playing and the start of the next are analysed for their beat; the
// next song then comes in on a beat of the current one at its tempo, the bass changes hands halfway and the
// next song eases back to its own tempo once the current one is gone.
import { DJ, mixPlan, beatOffset } from "./music-dj-model.js";

export function createDjMix({ invoke, sound }) {
  const grids = new Map();
  let running = null,
    last = null;

  function grid(key, url, from, length) {
    if (grids.has(key)) return grids.get(key);
    if (grids.size > 40) grids.delete(grids.keys().next().value);
    const entry = { done: false, value: null };
    grids.set(key, entry);
    if (!invoke || !url) entry.done = true;
    else
      invoke("music_beat_grid", { url, from, length })
        .then(value => (entry.value = value || null))
        .catch(() => (entry.value = null))
        .finally(() => (entry.done = true));
    return entry;
  }

  // What to do near the end of [current]: "mix" with a plan, "wait" while the beats are still being found,
  // or "fade" for an ordinary transition.
  function consider({ current, next, outgoing, incoming, remaining, fallback }) {
    const duration = outgoing.duration;
    if (!Number.isFinite(duration) || duration < 30 || !incoming?.src) return { kind: "fade" };
    // Analysis starts a minute and a half before the end, when the song is well buffered.
    if (remaining > 90) return { kind: "wait" };
    const from = Math.max(0, duration - DJ.tail),
      tail = grid(`${current.id}:tail`, outgoing.src, from, Math.min(DJ.tail, duration)),
      head = grid(`${next.id}:head`, incoming.src, 0, DJ.head);
    if (!tail.done || !head.done) return remaining > fallback + 0.5 ? { kind: "wait" } : { kind: "fade" };
    const plan = mixPlan({ outGrid: tail.value, inGrid: head.value, duration });
    if (!plan || outgoing.currentTime > plan.startAt + 0.05) return { kind: "fade" };
    return { kind: "mix", plan: { ...plan, outGrid: tail.value, inGrid: head.value } };
  }

  function cancel() {
    if (!running) return;
    const { incoming, outgoing, timers } = running;
    timers.forEach(clearTimeout);
    running = null;
    sound.resetBass(incoming);
    sound.resetBass(outgoing);
    sound.bend(incoming, 1);
  }

  // Runs once the next song has been handed to its player.
  function run(plan, outgoing, incoming) {
    cancel();
    const rate = outgoing.playbackRate || 1,
      wall = plan.length / rate,
      beat = plan.outPeriod / rate,
      src = incoming.src,
      timers = [];
    const mine = () => running?.timers === timers && incoming.src === src;
    running = { incoming, outgoing, timers };
    // The last mix and the beat offsets measured during it, for diagnostics.
    last = { plan, offsets: [] };
    sound.bend(incoming, plan.ratio);
    sound.bassSwap(incoming, outgoing, wall / 2 - beat / 2, beat, wall + 0.3);
    const offset = () =>
      beatOffset({
        outTime: outgoing.currentTime,
        outGrid: plan.outGrid,
        outPeriod: plan.outPeriod,
        inTime: incoming.currentTime,
        inGrid: plan.inGrid,
        inPeriod: plan.inPeriod,
      });
    // Starting a player is never exact. While the next song is still quiet a small jump puts its beats on
    // the current ones; later, a slight change of speed keeps them there without a sound.
    const jump = () => {
      if (!mine() || incoming.paused || outgoing.paused) return;
      const error = offset();
      last.offsets.push(Math.round(error * 1000));
      if (Math.abs(error) > 0.015) incoming.currentTime = Math.max(0, incoming.currentTime - error);
    };
    const nudge = () => {
      if (!mine() || incoming.paused || outgoing.paused) return;
      const error = offset();
      last.offsets.push(Math.round(error * 1000));
      sound.bend(incoming, plan.ratio * (1 - Math.max(-0.02, Math.min(0.02, error / 2))));
      timers.push(setTimeout(() => mine() && sound.bend(incoming, plan.ratio), 1000));
    };
    incoming.addEventListener(
      "playing",
      () => {
        if (!mine()) return;
        // Loading the source may have reset its speed; the tempo is set again once it really plays.
        sound.bend(incoming, plan.ratio);
        timers.push(setTimeout(jump, 250), setTimeout(jump, 1100));
        for (let at = 3; at < wall - 1; at += 2.5) timers.push(setTimeout(nudge, at * 1000));
        // Once the current song is gone, the next one eases back to its own tempo over a few bars.
        const steps = 16;
        for (let i = 1; i <= steps; i++)
          timers.push(
            setTimeout(
              () => {
                if (!mine()) return;
                sound.bend(incoming, plan.ratio + ((1 - plan.ratio) * i) / steps);
                if (i === steps) running = null;
              },
              (wall + 0.5 + i * 0.5) * 1000,
            ),
          );
      },
      { once: true },
    );
  }

  return {
    consider,
    run,
    cancel,
    get last() {
      return last;
    },
  };
}
