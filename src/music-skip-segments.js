// Skips community-marked non-music parts of music videos (SponsorBlock). A part is skipped once per
// play, so seeking back into it plays it, and nothing is skipped when the marks were made for a
// different cut of the video.
const empty = { segments: [], duration: 0 };
export function segmentsFor(data, mediaDuration) {
  const list = Array.isArray(data?.segments) ? data.segments : [];
  const marked = Number(data?.duration) || 0;
  if (!Number.isFinite(mediaDuration) || mediaDuration <= 0) return [];
  if (marked > 0 && Math.abs(marked - mediaDuration) > 3) return [];
  return list.filter(
    s =>
      Number.isFinite(s?.start) && Number.isFinite(s?.end) && s.end - s.start >= 1 && s.start < mediaDuration,
  );
}
// Returns where to jump, or null. [skipped] holds the indexes already skipped in this play.
export function segmentJump(segments, time, duration, skipped) {
  for (const [i, s] of segments.entries()) {
    if (skipped.has(i) || time < s.start || time >= s.end - 0.5) continue;
    skipped.add(i);
    // A part that runs to the end finishes the song, so the next one starts without the outro.
    return s.end >= duration - 1 ? duration : s.end;
  }
  return null;
}
export function createSegmentSkip({ invoke, enabled, allowed = () => true, onSkip = () => {} }) {
  const cache = new Map();
  let data = empty,
    skipped = new Set(),
    token = 0;
  return {
    load(id) {
      const own = ++token;
      data = empty;
      skipped = new Set();
      if (!enabled() || !/^[\w-]{11}$/.test(id || "")) return;
      if (!cache.has(id)) {
        if (cache.size > 300) cache.delete(cache.keys().next().value);
        cache.set(
          id,
          invoke("music_skip_segments", { id }).catch(() => {
            cache.delete(id);
            return empty;
          }),
        );
      }
      cache.get(id).then(value => {
        if (own === token) data = value || empty;
      });
    },
    check(audio) {
      if (!data.segments.length || !enabled() || !allowed() || audio.paused || audio.seeking) return;
      const duration = audio.duration,
        to = segmentJump(segmentsFor(data, duration), audio.currentTime, duration, skipped);
      if (to === null) return;
      audio.currentTime = to;
      onSkip();
    },
  };
}
