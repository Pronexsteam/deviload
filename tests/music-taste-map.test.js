import test from "node:test";
import assert from "node:assert/strict";
const { tasteGraph, tasteGroups, seedPosition } = await import("../src/music-taste-map-model.js");

const song = (id, artists) => ({ kind: "song", id, title: id, artists });
const entry = (id, artists, plays, lastPlayed) => ({
  item: song(id, artists),
  plays,
  score: plays ? 1 : 0,
  lastPlayed,
});

test("artists become stars sized by plays, joined by collaborations and listening in a row", () => {
  const minute = 60000;
  const graph = tasteGraph({
    entries: [
      entry("aaaaaaaaaaa", ["Alpha"], 10, 1 * minute),
      entry("bbbbbbbbbbb", ["Beta", "Alpha"], 4, 3 * minute),
      entry("ccccccccccc", ["Gamma"], 2, 500 * minute),
      entry("ddddddddddd", ["Delta"], 0, 0),
    ],
    recent: [],
  });
  const names = graph.nodes.map(node => node.name);
  assert.deepEqual(names, ["Alpha", "Beta", "Gamma"]);
  const link = graph.links.find(link => link.a === "alpha" && link.b === "beta");
  assert.ok(link && link.weight >= 3, "a collaboration and a play in a row");
  assert.ok(!graph.links.some(link => link.a === "gamma" || link.b === "gamma"), "too long apart");
});

test("neighbourhoods are coloured by size and stay stable", () => {
  const nodes = ["a", "b", "c", "x", "y"].map(key => ({ key }));
  const links = [
    { a: "a", b: "b", weight: 3 },
    { a: "b", b: "c", weight: 3 },
    { a: "a", b: "c", weight: 3 },
    { a: "x", b: "y", weight: 3 },
  ];
  const groups = tasteGroups(nodes, links);
  assert.equal(groups.get("a"), 0);
  assert.equal(groups.get("b"), 0);
  assert.equal(groups.get("c"), 0);
  assert.equal(groups.get("x"), groups.get("y"));
  assert.notEqual(groups.get("x"), 0);
  assert.deepEqual(seedPosition("alpha", 0, 10), seedPosition("alpha", 0, 10));
});

test("the map keeps only the strongest artists", () => {
  const entries = Array.from({ length: 80 }, (_, i) =>
    entry(String(i).padStart(11, "x"), [`Artist ${i}`], 80 - i, i * 1000),
  );
  const graph = tasteGraph({ entries, maxNodes: 20 });
  assert.equal(graph.nodes.length, 20);
  assert.equal(graph.nodes[0].name, "Artist 0");
});

test("each artist shows the cover of the song of theirs played most, led songs first", async () => {
  const { tasteGraph } = await import("../src/music-taste-map-model.js");
  const withCover = (id, artists, plays, image) => ({
    ...entry(id, artists, plays, 0),
    item: { ...song(id, artists), image },
  });
  const graph = tasteGraph({
    entries: [
      withCover("aaaaaaaaaaa", ["Alpha"], 3, "https://lh3.googleusercontent.com/alpha-solo"),
      withCover("bbbbbbbbbbb", ["Beta", "Alpha"], 5, "https://lh3.googleusercontent.com/duet"),
    ],
  });
  const byName = Object.fromEntries(graph.nodes.map(node => [node.name, node]));
  assert.equal(byName.Alpha.image, "https://lh3.googleusercontent.com/alpha-solo");
  assert.equal(byName.Beta.image, "https://lh3.googleusercontent.com/duet");
  assert.ok(!("imageWeight" in byName.Alpha));
});

test("covers that overlap on screen are pushed apart", async () => {
  const { separateStars } = await import("../src/music-taste-map-model.js");
  const stars = [
    { x: 0, y: 0, size: 20 },
    { x: 0.01, y: 0, size: 20 },
  ];
  const place = star => ({ x: star.x * 100, y: star.y * 100 });
  for (let i = 0; i < 20; i++) separateStars(stars, place, 100);
  assert.ok(Math.abs(stars[1].x - stars[0].x) * 100 >= 45);
  assert.equal(separateStars(stars, place, 100), false);
});
