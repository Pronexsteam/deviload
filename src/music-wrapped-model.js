// Devil Wrapped: the year in Devil Music as a short story of slides. This file only shapes the numbers; the
// picture is drawn by music-wrapped.js. Everything comes from what this device already keeps (the yearly recap
// and the likes), so nothing is sent anywhere to make it.
export const SLIDE_SECONDS = 4.6;

// The slides worth showing for this year, in order. A slide with nothing to say is left out, and a year with
// almost no listening gets no Wrapped at all.
export function wrappedSlides({ recap, likes = 0, year }) {
  const minutes = Math.max(0, Math.floor(Number(recap?.minutes) || 0)),
    plays = Math.max(0, Math.floor(Number(recap?.plays) || 0)),
    artists = (recap?.artists || []).filter(artist => artist?.name).slice(0, 5),
    songs = (recap?.songs || []).filter(song => song?.title).slice(0, 5),
    months = Array.isArray(recap?.months) ? recap.months : [];
  if (minutes < 10 || !songs.length) return [];
  // Most people have not listened here since January: the story names the months it really covers
  // (null when it is the whole year, or when the months are unknown).
  const first = months.findIndex(month => month.seconds > 0),
    since = first > 0 ? first : null;
  const slides = [{ kind: "intro", year, since }];
  slides.push({ kind: "minutes", minutes, plays, since, days: Math.round((minutes / 1440) * 10) / 10 });
  if (artists[0])
    slides.push({
      kind: "artist",
      name: artists[0].name,
      minutes: Math.floor(artists[0].seconds / 60),
      song: songs.find(song => sameArtist(song.artist, artists[0].name)) || null,
    });
  slides.push({
    kind: "songs",
    songs: songs.map(song => ({ ...song, minutes: Math.floor(song.seconds / 60) })),
  });
  if (artists.length > 1)
    slides.push({
      kind: "artists",
      artists: artists.map(artist => ({ name: artist.name, minutes: Math.floor(artist.seconds / 60) })),
    });
  const best = months.reduce(
    (top, month, index) => (month.seconds > (top?.seconds || 0) ? { ...month, index } : top),
    null,
  );
  if (best && months.filter(month => month.seconds > 0).length > 1)
    slides.push({
      kind: "month",
      index: best.index,
      minutes: Math.floor(best.seconds / 60),
      months: months.map(month => month.seconds),
    });
  if (likes > 0) slides.push({ kind: "likes", likes });
  slides.push({
    kind: "summary",
    year,
    since,
    minutes,
    artist: artists[0]?.name || "",
    songs: songs.slice(0, 3),
  });
  return slides;
}

const sameArtist = (a, b) =>
  typeof a === "string" && typeof b === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();

// Which slide plays at a moment of the story, and how far into it.
export function slideAt(slides, seconds) {
  if (!slides.length) return { index: -1, progress: 0 };
  const position = Math.max(0, seconds) / SLIDE_SECONDS,
    index = Math.min(slides.length - 1, Math.floor(position));
  return { index, progress: index === slides.length - 1 ? Math.min(1, position - index) : position - index };
}

export const storyLength = slides => slides.length * SLIDE_SECONDS;

// Wrapped is offered from December to the middle of January, when everyone looks back at their year.
export function wrappedSeason(date = new Date()) {
  const month = date.getMonth(),
    day = date.getDate();
  if (month === 11) return date.getFullYear();
  if (month === 0 && day <= 15) return date.getFullYear() - 1;
  return null;
}

// Counting up to a number in the first part of a slide, eased so it lands softly.
export function countUp(value, progress, share = 0.45) {
  const t = Math.min(1, Math.max(0, progress / share));
  return Math.round(value * (1 - (1 - t) ** 3));
}
