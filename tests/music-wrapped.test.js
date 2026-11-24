import test from "node:test";
import assert from "node:assert/strict";
import {
  wrappedSlides,
  wrappedPeriod,
  currentPeriod,
  monthOf,
  slideAt,
  storyLength,
  countUp,
  SLIDE_SECONDS,
} from "../src/music-wrapped-model.js";

const week = { kind: "week", key: "week-2026-11-22", label: "16 – 22 November" };
const recap = {
  minutes: 543,
  plays: 121,
  artists: [
    { name: "Daft Punk", seconds: 6000 },
    { name: "Tom Odell", seconds: 3000 },
  ],
  songs: [
    { id: "aaaaaaaaaaa", title: "Another Love", artist: "Tom Odell", seconds: 900 },
    { id: "bbbbbbbbbbb", title: "Get Lucky", artist: "Daft Punk", seconds: 800 },
  ],
  days: ["16", "17", "18", "19", "20", "21", "22"].map((day, i) => ({
    date: `2026-11-${day}`,
    seconds: i === 4 ? 9000 : i === 1 ? 1000 : 0,
  })),
};

test("a week becomes slides that only say what the numbers support", () => {
  const slides = wrappedSlides({ recap, period: week });
  assert.deepEqual(
    slides.map(slide => slide.kind),
    ["intro", "minutes", "artist", "songs", "artists", "day", "summary"],
  );
  assert.equal(slides[0].period.label, "16 – 22 November", "the story names the dates it covers");
  assert.equal(slides[2].song.title, "Get Lucky", "the top artist shows their own song");
  assert.equal(slides[5].date, "2026-11-20", "Friday was the busiest day");
  assert.equal(slides[5].minutes, 150);
  assert.equal(
    slides.some(slide => slide.kind === "likes"),
    false,
    "likes have no dates, so a week cannot claim them",
  );
});

test("a month has no day-by-day slide, and too little listening gives no story", () => {
  const month = { kind: "month", year: 2026, month: 10, key: "month-2026-11", label: "November 2026" };
  const slides = wrappedSlides({ recap: { ...recap, artists: [recap.artists[0]], days: [] }, period: month });
  assert.deepEqual(
    slides.map(slide => slide.kind),
    ["intro", "minutes", "artist", "songs", "summary"],
  );
  assert.deepEqual(wrappedSlides({ recap: { ...recap, minutes: 3 }, period: week }), []);
  assert.deepEqual(wrappedSlides({ recap, period: null }), []);
});

test("a Wrapped is ready at the end of a week and of a month", () => {
  // The last day of a month and the first three of the next look back at that month.
  assert.deepEqual(wrappedPeriod(new Date(2026, 10, 30)), {
    kind: "month",
    year: 2026,
    month: 10,
    key: "month-2026-11",
  });
  assert.equal(wrappedPeriod(new Date(2026, 11, 3)).key, "month-2026-11");
  assert.equal(wrappedPeriod(new Date(2027, 0, 2)).key, "month-2026-12");
  // Otherwise Sunday and Monday look back at the week, both under the Sunday's name.
  assert.deepEqual(wrappedPeriod(new Date(2026, 10, 22)), { kind: "week", key: "week-2026-11-22" });
  assert.equal(wrappedPeriod(new Date(2026, 10, 23)).key, "week-2026-11-22");
  assert.equal(wrappedPeriod(new Date(2026, 10, 25)), null, "a Wednesday has nothing to look back at");
  assert.equal(monthOf(currentPeriod("month", new Date(2026, 1, 10))), "2026-02");
  assert.equal(currentPeriod("week", new Date(2026, 1, 10)).kind, "week");
});

test("the story timeline and the counting", () => {
  const slides = wrappedSlides({ recap, period: week });
  assert.equal(storyLength(slides), slides.length * SLIDE_SECONDS);
  assert.deepEqual(slideAt(slides, 0), { index: 0, progress: 0 });
  assert.equal(slideAt(slides, SLIDE_SECONDS * 2.5).index, 2);
  assert.equal(slideAt(slides, 999).index, slides.length - 1);
  assert.equal(countUp(1000, 0), 0);
  assert.equal(countUp(1000, 1), 1000);
});
