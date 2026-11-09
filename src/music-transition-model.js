import { songAlbum } from "./music-ui-model.js";
export const TRANSITIONS = [0, 2, 4, 6, 8, 12];
const artist = item =>
  String(item?.artists?.[0] || item?.subtitle?.split(/ [·•] /)[0] || "")
    .trim()
    .toLocaleLowerCase();
export function sameAlbum(a, b) {
  const left = songAlbum(a).trim().toLocaleLowerCase(),
    right = songAlbum(b).trim().toLocaleLowerCase();
  return Boolean(left) && left === right && artist(a) === artist(b);
}
// Albums are mastered to flow into the next track, so they join without a fade.
export function transitionPlan({ transition = 0, seamless = true, current, next, remaining }) {
  if (!next || !Number.isFinite(remaining) || remaining <= 0) return null;
  if (seamless && sameAlbum(current, next))
    return remaining <= 0.6 ? { kind: "join", at: Math.max(0, remaining - 0.04) } : null;
  return transition > 0 && remaining <= transition ? { kind: "fade", overlap: remaining } : null;
}
