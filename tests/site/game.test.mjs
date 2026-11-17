// Tests for site/js/game.js, the game's rules with no DOM: which pairs
// are fair to ask, who wins, and the draw of pairs and questions.
// Packages are small literals shaped like data/game.json's entries.

import { test } from "node:test";
import assert from "node:assert/strict";

import { QUESTIONS, ROUND_MIX, drawPair, fair, randomType, winner } from "../../site/js/game.js";
import { seeded } from "./random.mjs";

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
  const random = seeded(7);
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

// Tests that every question comes up, each about as often as its share
// of ROUND_MIX.
test("randomType follows the round mix", () => {
  const random = seeded(3);
  const draws = 10_000;
  const seen = {};
  for (let i = 0; i < draws; i++) {
    const type = randomType(random);
    seen[type] = (seen[type] ?? 0) + 1;
  }
  assert.deepEqual(Object.keys(seen).sort(), Object.keys(QUESTIONS).sort());
  for (const type of Object.keys(QUESTIONS)) {
    const share = ROUND_MIX.filter((t) => t === type).length / ROUND_MIX.length;
    assert.ok(Math.abs(seen[type] / draws - share) < 0.02, `${type}: ${seen[type]}`);
  }
});
