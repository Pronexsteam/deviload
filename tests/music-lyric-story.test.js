import test from "node:test";
import assert from "node:assert/strict";
const {
  storyWindow,
  storyTokens,
  storyChunks,
  storyLayout,
  tokenLight,
  storyFade,
  storyFileName,
  storyType,
  STORY,
} = await import("../src/music-lyric-story-model.js");

const timeline = {
  lines: [
    { text: "First line", at: 10, end: 13, words: [] },
    {
      text: "BELIEVE it",
      at: 13,
      end: 16,
      words: [
        { text: "BE", at: 13, end: 13.4 },
        { text: "LIEVE ", at: 13.4, end: 14 },
        { text: "it", at: 14, end: 15 },
      ],
    },
    { text: "", at: 16, end: 18, words: [] },
  ],
};

test("a story covers the chosen lines with a little air, within story limits", () => {
  const span = storyWindow(timeline, [0, 1]);
  assert.equal(span.start, 10 - STORY.lead);
  assert.equal(span.end, 16 + STORY.tail);
  assert.equal(storyWindow(timeline, [2]), null);
  assert.equal(storyWindow({ lines: [] }, [0]), null);
  const long = storyWindow({ lines: [{ text: "a", at: 0, end: 90 }] }, [0]);
  assert.ok(Math.abs(long.end - long.start - STORY.max) < 1e-9);
  const short = storyWindow({ lines: [{ text: "a", at: 5, end: 5.5 }] }, [0]);
  assert.ok(Math.abs(short.end - short.start - STORY.min) < 1e-9);
  assert.equal(storyWindow(timeline, [1], 15).end, 15);
});

test("timed syllables stay one word and light in turn; untimed lines light together", () => {
  const tokens = storyTokens(timeline.lines[1]);
  assert.deepEqual(
    storyChunks(tokens).map(chunk => chunk.map(token => token.text).join("")),
    ["BELIEVE ", "it"],
  );
  const plain = storyTokens(timeline.lines[0]);
  assert.deepEqual(
    plain.map(token => token.text),
    ["First ", "line"],
  );
  assert.ok(plain.every(token => token.at === 10));
  assert.equal(tokenLight(tokens[0], 12), 0);
  assert.ok(Math.abs(tokenLight(tokens[0], 13.2) - 0.5) < 1e-9);
  assert.equal(tokenLight(tokens[0], 20), 1);
  assert.ok(tokenLight(plain[0], 10.09) > 0.4 && tokenLight(plain[0], 10.09) < 0.6);
});

test("the words fit the box, larger when there are fewer", () => {
  const measure = (text, size) => text.length * size * 0.55;
  const box = { x: 0, y: 0, width: 900, height: 560 };
  const one = storyLayout([timeline.lines[0]], box, measure);
  const two = storyLayout(timeline.lines.slice(0, 2), box, measure);
  assert.ok(one.size >= two.size);
  for (const token of two.tokens) assert.ok(token.x + token.width <= 900 + 1);
  assert.ok(two.tokens.every(token => token.y > 0 && token.y <= 560));
});

test("fades, names and formats", () => {
  const span = { start: 0, end: 10 };
  assert.equal(storyFade(0, span), 0);
  assert.equal(storyFade(5, span), 1);
  assert.ok(storyFade(9.7, span) < 1);
  assert.equal(storyFileName("Believer!", "Imagine Dragons"), "Imagine Dragons - Believer story");
  assert.equal(storyFileName("", ""), "Devil Music story");
  assert.equal(
    storyType(type => type.startsWith("video/webm")),
    "video/webm;codecs=vp9,opus",
  );
  assert.equal(
    storyType(() => false),
    "",
  );
});

test("rows are centred and the clock reads like a player", async () => {
  const { storyLayout, clockText, restingWave } = await import("../src/music-lyric-story-model.js");
  const measure = (text, size) => text.length * size * 0.5;
  const layout = storyLayout(
    [{ text: "ab", at: 0, end: 1, words: [] }],
    { x: 100, y: 0, width: 800, height: 400 },
    measure,
  );
  const token = layout.tokens[0];
  assert.ok(Math.abs(token.x - 100 - (800 - token.width) / 2) <= 1);
  assert.equal(clockText(75.9), "1:15");
  assert.equal(clockText(-3), "0:00");
  const wave = restingWave(9);
  assert.ok(wave[4] > wave[0] && wave.every(value => value > 0.1));
});

test("a wrapped line is split evenly, not with one word left alone", async () => {
  const { storyLayout } = await import("../src/music-lyric-story-model.js");
  const measure = (text, size) => text.length * size * 0.5;
  const layout = storyLayout(
    [{ text: "And everything you do", at: 0, end: 1, words: [] }],
    { x: 0, y: 0, width: 800, height: 400 },
    measure,
  );
  const rows = Object.values(Object.groupBy(layout.tokens, token => token.row)).map(row => row.length);
  assert.deepEqual(rows, [2, 2]);
});
