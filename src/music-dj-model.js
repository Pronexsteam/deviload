// The arithmetic of a DJ transition. The grids come from music_beat_grid: { bpm, first, confidence }, where
// [first] is one beat in seconds from the start of the song.

export const DJ = {
  // A beat that stands out less than this mixes as a plain fade.
  confidence: 1.6,
  // The next song may be sped up or slowed down by at most this share to meet the tempo.
  stretch: 0.08,
  // The overlap is a whole phrase, within these limits in seconds.
  shortest: 6,
  longest: 20,
  // The stretch of each song that is analysed: the end of the one playing and the start of the next.
  tail: 50,
  head: 40,
};

// How much faster the next song must play to meet the current tempo, allowing half and double time.
// Null when the tempos are too far apart to meet without being heard.
export function matchTempo(outBpm, inBpm) {
  if (!(outBpm > 0) || !(inBpm > 0)) return null;
  let best = null;
  for (const factor of [0.5, 1, 2]) {
    const ratio = outBpm / (inBpm * factor);
    if (Math.abs(ratio - 1) <= DJ.stretch && (!best || Math.abs(ratio - 1) < Math.abs(best.ratio - 1)))
      best = { ratio, factor };
  }
  return best;
}

const usable = grid =>
  grid && grid.bpm > 0 && Number.isFinite(grid.first) && grid.confidence >= DJ.confidence;

// When to start the next song, from where, and for how long both play. Times are in each song's own seconds.
export function mixPlan({ outGrid, inGrid, duration }) {
  if (!usable(outGrid) || !usable(inGrid) || !(duration > 0)) return null;
  const tempo = matchTempo(outGrid.bpm, inGrid.bpm);
  if (!tempo) return null;
  const period = 60 / outGrid.bpm;
  // Sixteen beats is a phrase in most dance and pop music; slow songs take eight.
  let beats = outGrid.bpm < 100 ? 8 : 16;
  while (beats * period > DJ.longest && beats > 4) beats /= 2;
  if (beats * period < DJ.shortest) beats *= 2;
  const length = beats * period;
  // The last beat that leaves the whole phrase before the end, with a moment to spare.
  const latest = duration - length - 0.5;
  if (latest < outGrid.first) return null;
  const startAt = outGrid.first + Math.floor((latest - outGrid.first) / period) * period;
  if (startAt < duration * 0.5) return null;
  // The next song comes in on its first beat, or a little before it so the fade starts from its intro.
  const inPeriod = 60 / (inGrid.bpm * tempo.factor);
  let inStart = inGrid.first;
  while (inStart > 12) inStart -= inPeriod * 4;
  if (inStart < 0) inStart += Math.ceil(-inStart / inPeriod) * inPeriod;
  return { startAt, inStart, length, beats, ratio: tempo.ratio, inPeriod, outPeriod: period };
}

// How far the next song's beats are from the current song's, in the next song's own seconds; positive when
// the next song is ahead. The answer is the nearest way round, at most half a beat.
export function beatOffset({ outTime, outGrid, outPeriod, inTime, inGrid, inPeriod }) {
  const outPhase = ((((outTime - outGrid.first) / outPeriod) % 1) + 1) % 1,
    inPhase = ((((inTime - inGrid.first) / inPeriod) % 1) + 1) % 1;
  let difference = inPhase - outPhase;
  if (difference > 0.5) difference -= 1;
  if (difference < -0.5) difference += 1;
  return difference * inPeriod;
}

// Volume in a DJ mix: the next song is up before the middle, the current one leaves after it.
export function djFade(progress) {
  const p = Math.max(0, Math.min(1, progress));
  return {
    in: Math.sin((Math.min(1, p / 0.55) * Math.PI) / 2),
    out: Math.cos((Math.max(0, (p - 0.45) / 0.55) * Math.PI) / 2),
  };
}
