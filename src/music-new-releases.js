// New albums and singles from the artists the person follows, for a shelf on the home. Each artist's page lists
// albums and singles with their year; releases from this year and the last one are kept, newest first. The pages
// are read one at a time, for at most a few artists, and the shelf is kept for half a day.
export const RELEASES_KEY = "deviload-new-releases-v1";
const KEEP_MS = 12 * 3600000,
  ARTISTS = 8,
  LIMIT = 16;

const yearOf = item => {
  const years = String(item?.subtitle || "").match(/\b(19|20)\d{2}\b/g);
  return years ? Number(years.at(-1)) : 0;
};

// The albums and singles on one artist page that came out this year or last year.
export function releasesFromPage(page, artist, thisYear) {
  const out = [];
  for (const section of page?.sections || [])
    for (const item of section.items || [])
      if (item?.kind === "album" && typeof item.id === "string" && yearOf(item) >= thisYear - 1)
        out.push({
          ...item,
          year: yearOf(item),
          // On the home the artist is not on the page around it, so the card names them.
          subtitle: [artist.title, item.subtitle].filter(Boolean).join(" · "),
        });
  return out;
}

// Newest year first; within a year the page's own order, one artist after another so no artist fills the shelf.
export function mergeReleases(lists, limit = LIMIT) {
  const seen = new Set(),
    byYear = new Map();
  lists.forEach((list, artist) =>
    list.forEach((item, position) => {
      if (seen.has(item.id)) return;
      seen.add(item.id);
      const year = byYear.get(item.year) || [];
      year.push({ item, artist, position });
      byYear.set(item.year, year);
    }),
  );
  return [...byYear.keys()]
    .sort((a, b) => b - a)
    .flatMap(year => byYear.get(year).sort((a, b) => a.position - b.position || a.artist - b.artist))
    .map(entry => entry.item)
    .slice(0, limit);
}

export function createNewReleases({
  loadArtist,
  storage = globalThis.localStorage,
  now = Date.now,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) {
  let running = null;
  const read = () => {
    try {
      const value = JSON.parse(storage?.getItem(RELEASES_KEY) || "null");
      return value && Array.isArray(value.items) ? value : null;
    } catch {
      return null;
    }
  };
  return {
    // What the shelf showed last time, at once, while a newer one may be on its way.
    cached(artists, language) {
      const value = read();
      return value && value.key === key(artists, language) ? value.items : [];
    },
    load(artists, language) {
      const chosen = artists.filter(artist => artist?.kind === "artist").slice(0, ARTISTS);
      if (!chosen.length) return Promise.resolve([]);
      const value = read(),
        wanted = key(chosen, language);
      if (value && value.key === wanted && now() - value.at < KEEP_MS) return Promise.resolve(value.items);
      running ||= (async () => {
        const thisYear = new Date(now()).getFullYear(),
          lists = [];
        let failures = 0;
        for (const artist of chosen) {
          try {
            lists.push(releasesFromPage(await loadArtist(artist, language), artist, thisYear));
          } catch {
            lists.push([]);
            failures++;
          }
          await pause(300);
        }
        const items = mergeReleases(lists);
        // A reading that failed for every artist keeps the shelf that was there.
        if (failures === chosen.length) return value?.items || [];
        try {
          storage?.setItem(RELEASES_KEY, JSON.stringify({ key: wanted, at: now(), items }));
        } catch {
          /* Shown this time; read again next time. */
        }
        return items;
      })().finally(() => (running = null));
      return running;
    },
  };
}
const key = (artists, language) =>
  language +
  "|" +
  artists
    .filter(artist => artist?.kind === "artist")
    .slice(0, ARTISTS)
    .map(artist => artist.id)
    .join(",");
