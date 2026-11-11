// The library as a file other apps read: a spreadsheet (CSV), a playlist for players (M3U) or plain data (JSON).
// Liked songs and every playlist, with the YouTube Music address of each song. Songs from files on this computer are
// listed by name only: their location is the person's own business.
export const LIBRARY_FORMATS = ["csv", "m3u", "json"];
const youtube = id => (/^[\w-]{11}$/.test(id || "") ? `https://music.youtube.com/watch?v=${id}` : "");
const artistsOf = item =>
  (Array.isArray(item.artists) && item.artists.length ? item.artists : [item.subtitle || ""])
    .filter(Boolean)
    .join(", ");

export function libraryLists(saved, likedName = "Liked songs") {
  return [
    { name: likedName, items: Array.isArray(saved?.favorites) ? saved.favorites : [] },
    ...(Array.isArray(saved?.playlists) ? saved.playlists : []).map(list => ({
      name: list.name,
      items: Array.isArray(list.items) ? list.items : [],
    })),
  ].filter(list => list.items.length);
}

// A cell that a spreadsheet will neither split nor run as a formula.
const cell = value => {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const line = value => String(value ?? "").replace(/[\r\n]+/g, " ");

export function exportLibrary(saved, format, { likedName = "Liked songs", now = new Date() } = {}) {
  const lists = libraryLists(saved, likedName);
  if (format === "csv") {
    const rows = [["Playlist", "Title", "Artists", "Album", "Duration", "YouTube Music"]];
    for (const list of lists)
      for (const item of list.items)
        rows.push([
          list.name,
          item.title,
          artistsOf(item),
          item.album || "",
          Number.isFinite(item.duration) ? Math.round(item.duration) : "",
          youtube(item.id),
        ]);
    // A byte order mark tells Excel the file is UTF-8, so other alphabets survive.
    return "﻿" + rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
  }
  if (format === "m3u") {
    const out = ["#EXTM3U"];
    for (const list of lists) {
      out.push("", `#PLAYLIST:${line(list.name)}`);
      for (const item of list.items) {
        const address = youtube(item.id);
        if (!address) continue;
        const seconds = Number.isFinite(item.duration) ? Math.round(item.duration) : -1;
        out.push(`#EXTINF:${seconds},${line(artistsOf(item))} - ${line(item.title)}`, address);
      }
    }
    return out.join("\n") + "\n";
  }
  if (format === "json")
    return JSON.stringify(
      {
        format: "devil-music-library",
        version: 1,
        exportedAt: now.toISOString(),
        playlists: lists.map(list => ({
          name: list.name,
          songs: list.items.map(item => ({
            title: item.title,
            artists: Array.isArray(item.artists) ? item.artists : [],
            ...(item.album ? { album: item.album } : {}),
            ...(Number.isFinite(item.duration) ? { duration: item.duration } : {}),
            ...(youtube(item.id) ? { youtubeMusic: youtube(item.id) } : {}),
          })),
        })),
      },
      null,
      2,
    );
  throw new TypeError(format);
}
