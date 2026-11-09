const KEY = "deviload-app-release-notes";
const shown = new Set();
export function shouldShowReleaseNotes(storage, version) {
  if (typeof version !== "string" || !version.trim() || shown.has(version)) return false;
  try {
    return storage?.getItem(KEY) !== `deviload-${version}`;
  } catch {
    return true;
  }
}
export function markReleaseNotesSeen(storage, version) {
  if (typeof version !== "string" || !version.trim()) return;
  shown.add(version);
  try {
    storage?.setItem(KEY, `deviload-${version}`);
  } catch {
    /* Once per session with unavailable storage. */
  }
}
// The version whose notes were last shown, read before the current ones are marked as seen.
export function lastSeenReleaseNotes(storage) {
  try {
    const value = storage?.getItem(KEY) || "";
    return value.startsWith("deviload-") ? value.slice(9) : null;
  } catch {
    return null;
  }
}
const parts = value =>
  String(value || "")
    .split("-")[0]
    .split(".")
    .map(part => Number(part) || 0);
// Orders release numbers; a pre-release counts as its release, so 2.11.0-beta.1 reads the 2.11.0 notes.
export function compareVersions(a, b) {
  const x = parts(a),
    y = parts(b);
  for (let index = 0; index < 3; index++) {
    const left = x[index] || 0,
      right = y[index] || 0;
    if (left !== right) return left > right ? 1 : -1;
  }
  return 0;
}
