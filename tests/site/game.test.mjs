// Tests for site/js/game.js, the game's rules with no DOM: the seeded
// random numbers, which pairs are fair to ask, who wins, the daily draw
// and the share line. Packages are small literals shaped like
// data/game.json's entries.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  QUESTIONS,
  dailyNumber,
  dailyRounds,
  drawPair,
  fair,
  hashString,
  mulberry32,
  shareText,
  winner,
} from "../../site/js/game.js";

function pkg(attr, fields = {}) {
  return {
    attr,
    rebuilds: null,
    closureSize: null,
    versions: null,
    firstSeen: null,
    ...fields,
  };
}

// Tests hashString against FNV-1a's published 32-bit test vectors.
test("hashString is 32-bit FNV-1a", () => {
  assert.equal(hashString(""), 0x811c9dc5);
  assert.equal(hashString("a"), 0xe40c292c);
  assert.equal(hashString("foobar"), 0xbf9cf968);
});

// Tests that one seed always gives one sequence, inside [0, 1), and that
// two seeds give two different ones.
test("mulberry32 is deterministic and in range", () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const c = mulberry32(43);
  const xs = Array.from({ length: 1000 }, () => a());
  assert.deepEqual(
    xs,
    Array.from({ length: 1000 }, () => b()),
  );
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.notEqual(xs[0], c());
});

// Tests the fairness rules one question at a time with pairs that sit
// either side of each bound.
test("fair rejects ties, coin flips and blowouts", () => {
  const r = (n) => pkg(`r${n}`, { rebuilds: n });
  assert.equal(fair("rebuilds", r(1000), r(1000)), false, "a tie");
  assert.equal(fair("rebuilds", r(1000), r(1050)), false, "too close");
  assert.equal(fair("rebuilds", r(1000), r(3000)), true);
  assert.equal(fair("rebuilds", r(0), r(5)), true, "small counts compare by count+1");
  assert.equal(fair("rebuilds", r(2), r(60000)), false, "a blowout");

  const s = (n) => pkg(`s${n}`, { closureSize: n });
  assert.equal(fair("closureSize", s(100e6), s(300e6)), true);
  assert.equal(fair("closureSize", s(10e6), s(2e9)), false);

  const v = (n) => pkg(`v${n}`, { versions: n });
  assert.equal(fair("versions", v(10), v(11)), false, "one version apart");
  assert.equal(fair("versions", v(10), v(14)), true);
  assert.equal(fair("versions", v(2), v(40)), false);

  const f = (after, by) => pkg(`f${by}`, { firstSeen: { after, by } });
  assert.equal(
    fair("firstSeen", f("2013-10-31", "2016-09-24"), f("2016-09-24", "2016-10-13")),
    false,
    "windows adjacent: too close to call",
  );
  assert.equal(fair("firstSeen", f(null, "2012-07-05"), f("2013-10-31", "2016-09-24")), true);
  assert.equal(
    fair("firstSeen", f("2013-10-31", "2016-09-24"), f("2015-01-01", "2015-02-01")),
    false,
    "windows overlap: the answer is unknown",
  );
  assert.equal(fair("rebuilds", r(5), pkg("none")), false, "a missing value");
});

// Tests that the higher number wins, except for first-seen where the
// earlier date does.
test("winner picks the higher value, or the earlier date", () => {
  const a = pkg("a", { rebuilds: 10, firstSeen: { after: null, by: "2012-07-05" } });
  const b = pkg("b", { rebuilds: 20, firstSeen: { after: "2018-01-01", by: "2018-02-01" } });
  assert.equal(winner("rebuilds", a, b), 1);
  assert.equal(winner("rebuilds", b, a), 0);
  assert.equal(winner("firstSeen", a, b), 0);
  assert.equal(winner("firstSeen", b, a), 1);
});

const POOL = Array.from({ length: 60 }, (_, i) =>
  pkg(`p${i}`, {
    rebuilds: Math.round(10 * 1.5 ** (i % 20)),
    closureSize: 1e6 * (i + 1),
    versions: 1 + i,
    firstSeen: {
      after: i === 0 ? null : `20${12 + (i % 13)}-01-01`,
      by: `20${12 + (i % 13)}-03-01`,
    },
  }),
);

// Tests that a drawn pair is fair, two distinct packages, and avoids the
// excluded names, and that an impossible draw returns null.
test("drawPair draws fair pairs and honours the exclusions", () => {
  const random = mulberry32(7);
  const exclude = new Set(["p0", "p1", "p2"]);
  for (const type of Object.keys(QUESTIONS)) {
    for (let i = 0; i < 50; i++) {
      const pair = drawPair(POOL, type, random, exclude);
      assert.ok(pair, type);
      const [a, b] = pair;
      assert.notEqual(a.attr, b.attr);
      assert.ok(fair(type, a, b));
      assert.ok(!exclude.has(a.attr) && !exclude.has(b.attr));
    }
  }
  const twins = [pkg("x", { versions: 3 }), pkg("y", { versions: 3 })];
  assert.equal(drawPair(twins, "versions", random), null);
});

// Tests the daily game: one date always gives the same ten rounds, with
// the fixed mix of questions and no package twice, and the next date
// gives different rounds.
test("dailyRounds is a pure function of the date", () => {
  const today = dailyRounds(POOL, "2026-11-16");
  assert.deepEqual(today, dailyRounds(POOL, "2026-11-16"));
  assert.notDeepEqual(today, dailyRounds(POOL, "2026-11-17"));
  assert.equal(today.length, 10);

  const mix = {};
  for (const round of today) {
    mix[round.type] = (mix[round.type] ?? 0) + 1;
  }
  assert.deepEqual(mix, { rebuilds: 4, closureSize: 2, versions: 2, firstSeen: 2 });

  const attrs = today.flatMap((r) => [r.a.attr, r.b.attr]);
  assert.equal(new Set(attrs).size, attrs.length);
  for (const round of today) {
    assert.ok(fair(round.type, round.a, round.b));
  }
});

// Tests the puzzle number, counted from the first daily game.
test("dailyNumber counts days from launch", () => {
  assert.equal(dailyNumber("2026-11-16"), 1);
  assert.equal(dailyNumber("2026-11-17"), 2);
  assert.equal(dailyNumber("2027-11-16"), 366);
});

// Tests the share line, character for character.
test("shareText is one plain line", () => {
  const results = [true, true, false, true, true, true, false, true, true, true];
  assert.equal(
    shareText("2026-11-17", results, "https://example.org/rhl/"),
    "Rebuild Higher or Lower #2 2026-11-17: 8/10 ++-+++-+++ https://example.org/rhl/",
  );
});
