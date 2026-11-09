// Two decoders let a prepared track start without reopening its media URL.
import { musicGain } from "./music-volume.js";
// Equal-power curves keep the combined loudness steady through an overlap.
export const fadeCurve = progress => {
  const p = Math.max(0, Math.min(1, progress));
  return { in: Math.sin((p * Math.PI) / 2), out: Math.cos((p * Math.PI) / 2) };
};
export function createMusicDecks({
  makeAudio = () => new Audio(),
  now = Date.now,
  schedule = setInterval,
  cancel = clearInterval,
} = {}) {
  const nodes = [makeAudio(), makeAudio()];
  let active = nodes[0],
    prepared = null,
    tail = null,
    level = 0,
    dim = 1;
  for (const [index, node] of nodes.entries()) {
    node.id = `music-audio${index ? "-next" : ""}`;
    node.hidden = true;
    node.preload = "auto";
    node.crossOrigin = "anonymous";
  }
  function release(node) {
    node.pause();
    node.removeAttribute("src");
    node.load();
  }
  const gain = () => level * dim;
  const progress = () => (tail ? Math.min(1, (now() - tail.start) / tail.duration) : 1);
  function apply() {
    const value = gain(),
      curve = fadeCurve(progress());
    active.volume = tail ? value * curve.in : value;
    for (const node of nodes)
      if (node !== active) node.volume = tail?.node === node ? value * curve.out : value;
  }
  function stopTail() {
    if (tail) {
      const old = tail;
      tail = null;
      cancel(old.timer);
      release(old.node);
      apply();
    }
  }
  function setVolume(value) {
    level = musicGain(value);
    apply();
  }
  return {
    nodes,
    get current() {
      return active;
    },
    owns: node => nodes.includes(node),
    stopTail,
    setVolume,
    setDim(value) {
      dim = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
      apply();
    },
    ready(id) {
      return (
        prepared?.id === id &&
        now() - prepared.at < 240000 &&
        prepared.node.readyState >= 3 &&
        !prepared.node.error
      );
    },
    warm(id, url) {
      if (prepared?.id === id && prepared.url === url && now() - prepared.at < 240000 && !prepared.node.error)
        return prepared.node;
      stopTail();
      const node = nodes.find(node => node !== active);
      node.pause();
      node.src = url;
      node.load();
      prepared = { id, url, node, at: now() };
      return node;
    },
    take(id, volume, overlap = 0) {
      if (!this.ready(id)) return null;
      stopTail();
      const old = active;
      active = prepared.node;
      prepared = null;
      level = musicGain(volume);
      // Very short overlaps are seamless album joins: the old track has ended.
      if (overlap > 0.15 && !old.paused) {
        tail = { node: old, start: now(), duration: overlap * 1000, timer: null };
        apply();
        tail.timer = schedule(() => {
          apply();
          if (progress() >= 1) stopTail();
        }, 30);
      } else {
        release(old);
        apply();
      }
      return active;
    },
    clear() {
      stopTail();
      prepared = null;
      const node = nodes.find(node => node !== active);
      node.pause();
      node.removeAttribute("src");
      node.load();
    },
    listen(name, handler) {
      for (const node of nodes)
        node.addEventListener(name, event => {
          if (node === active) handler(event);
        });
    },
  };
}
