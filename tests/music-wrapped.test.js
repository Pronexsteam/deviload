import test from "node:test";
import assert from "node:assert/strict";
import {
  wrappedSlides,
  slideAt,
  storyLength,
  wrappedSeason,
  countUp,
  SLIDE_SECONDS,
} from "../src/music-wrapped-model.js";

const recap = {
  minutes: 5432,
  plays: 1210,
  artists: [
    { name: "Daft Punk", seconds: 60000 },
    { name: "Tom Odell", seconds: 30000 },
  ],
  songs: [
    { id: "aaaaaaaaaaa", title: "Another Love", artist: "Tom Odell", seconds: 9000 },
    { id: "bbbbbbbbbbb", title: "Get Lucky", artist: "Daft Punk", seconds: 8000 },
  ],
  months: Array.from({ length: 12 }, (_, i) => ({
    key: `2026-${i + 1}`,
    seconds: i === 10 ? 90000 : i === 3 ? 1000 : 0,
  })),
};

test("the year becomes slides that only say what the numbers support", () => {
  const slides = wrappedSlides({ recap, likes: 42, year: 2026 });
  assert.deepEqual(
    slides.map(slide => slide.kind),
    ["intro", "minutes", "artist", "songs", "artists", "month", "likes", "summary"],
  );
  assert.equal(slides[1].days, 3.8);
  assert.equal(slides[2].song.title, "Get Lucky", "the top artist shows their own song");
  assert.equal(slides[5].index, 10, "November was the busiest month");
  assert.equal(slides[0].since, 3, "listening began in April, and the story says so");
  const allYear = wrappedSlides({
    recap: { ...recap, months: recap.months.map(m => ({ ...m, seconds: 100 })) },
    year: 2026,
  });
  assert.equal(allYear[0].since, null, "a whole year is just the year");
  const quiet = wrappedSlides({
    recap: { ...recap, artists: [recap.artists[0]], months: [] },
    likes: 0,
    year: 2026,
  });
  assert.deepEqual(
    quiet.map(slide => slide.kind),
    ["intro", "minutes", "artist", "songs", "summary"],
  );
  assert.deepEqual(
    wrappedSlides({ recap: { ...recap, minutes: 3 }, year: 2026 }),
    [],
    "too little listening for a Wrapped",
  );
});

test("the story timeline, the season and the counting", () => {
  const slides = wrappedSlides({ recap, likes: 1, year: 2026 });
  assert.equal(storyLength(slides), slides.length * SLIDE_SECONDS);
  assert.deepEqual(slideAt(slides, 0), { index: 0, progress: 0 });
  assert.equal(slideAt(slides, SLIDE_SECONDS * 2.5).index, 2);
  assert.equal(slideAt(slides, 999).index, slides.length - 1);
  assert.equal(wrappedSeason(new Date(2026, 11, 3)), 2026);
  assert.equal(wrappedSeason(new Date(2027, 0, 10)), 2026);
  assert.equal(wrappedSeason(new Date(2027, 0, 20)), null);
  assert.equal(wrappedSeason(new Date(2026, 10, 24)), null);
  assert.equal(countUp(1000, 0), 0);
  assert.equal(countUp(1000, 1), 1000);
});
