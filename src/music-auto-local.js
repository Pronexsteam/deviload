// A local source is tried only while recovering a failed foreground selection.
export async function findLocalRecording(track, invoke) {
  const core = globalThis.window?.__TAURI__?.core;
  const artists = track?.artists;
  if (
    !core?.convertFileSrc ||
    track?.kind !== "song" ||
    typeof track.title !== "string" ||
    !track.title.trim() ||
    !Array.isArray(artists) ||
    !artists.length ||
    artists.some(name => typeof name !== "string" || !name.trim()) ||
    !Number.isFinite(track.duration) ||
    track.duration <= 0
  )
    return null;
  try {
    const path = await invoke("music_local_equivalent", {
      title: track.title,
      artists,
      duration: track.duration,
      album: typeof track.album === "string" ? track.album : null,
    });
    return path ? { url: core.convertFileSrc(path), offline: true } : null;
  } catch {
    return null;
  }
}
