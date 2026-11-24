// Devil Wrapped: a week or a month of Devil Music as a short story of slides. This file only shapes the
// numbers; the picture is drawn by music-wrapped.js. Everything comes from what this device keeps (the last seven
// days in detail and a total for each month), so the story covers exactly the listening it shows and nothing
// is sent anywhere to make it.
export const SLIDE_SECONDS = 4.6;

// The slides worth showing for a period, in order. A slide with nothing to say is left out, and a period with
// almost no listening gets no Wrapped at all. [recap.days] is the week day by day; a month has none.
export function wrappedSlides({ recap, period }) {
  const minutes = Math.max(0, Math.floor(Number(recap?.minutes) || 0)),
    plays = Math.max(0, Math.floor(Number(recap?.plays) || 0)),
    artists = (recap?.artists || []).filter(artist => artist?.name).slice(0, 5),
    songs = (recap?.songs || []).filter(song => song?.title).slice(0, 5),
    days = Array.isArray(recap?.days) ? recap.days : [];
  if (minutes < 10 || !songs.length || !period) return [];
  const slides = [{ kind: "intro", period }];
  slides.push({ kind: "minutes", period, minutes, plays });
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
  const best = days.reduce(
    (top, day, index) => (day.seconds > (top?.seconds || 0) ? { ...day, index } : top),
    null,
  );
  if (best && days.filter(day => day.seconds > 0).length > 1)
    slides.push({
      kind: "day",
      index: best.index,
      date: best.date,
      minutes: Math.floor(best.seconds / 60),
      days: days.map(day => ({ date: day.date, seconds: day.seconds })),
    });
  slides.push({
    kind: "summary",
    period,
    minutes,
    artist: artists[0]?.name || "",
    songs: songs.slice(0, 3),
  });
  return slides;
}

const pad = value => String(value).padStart(2, "0");
const dayKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

// The Wrapped ready on a given day: a month from its last day to the third of the next, otherwise the week on
// Sunday and Monday. [key] tells one period from another, so a dismissed banner stays away until the next.
export function wrappedPeriod(date = new Date()) {
  const year = date.getFullYear(),
    month = date.getMonth(),
    day = date.getDate(),
    last = new Date(year, month + 1, 0).getDate();
  if (day === last) return { kind: "month", year, month, key: `month-${year}-${pad(month + 1)}` };
  if (day <= 3) {
    const before = new Date(year, month - 1, 1);
    return {
      kind: "month",
      year: before.getFullYear(),
      month: before.getMonth(),
      key: `month-${before.getFullYear()}-${pad(before.getMonth() + 1)}`,
    };
  }
  const weekday = date.getDay();
  if (weekday === 0 || weekday === 1) {
    const sunday = new Date(year, month, day - weekday);
    return { kind: "week", key: `week-${dayKey(sunday)}` };
  }
  return null;
}

// The period that the stats window offers: the current week or the current month.
export const currentPeriod = (kind, date = new Date()) =>
  kind === "month"
    ? {
        kind,
        year: date.getFullYear(),
        month: date.getMonth(),
        key: `month-${date.getFullYear()}-${pad(date.getMonth() + 1)}`,
      }
    : { kind: "week", key: `week-${dayKey(date)}` };

// "2026-11" for a month period, as the weekly statistics name their months.
export const monthOf = period => `${period.year}-${pad(period.month + 1)}`;

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

// Counting up to a number in the first part of a slide, eased so it lands softly.
export function countUp(value, progress, share = 0.45) {
  const t = Math.min(1, Math.max(0, progress / share));
  return Math.round(value * (1 - (1 - t) ** 3));
}
