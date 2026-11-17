// Tests the committed data/game.json and data/deep.json against what the
// page needs: the schema data.js accepts, the proof fields every reveal
// shows, a value for every question on most packages, and a steady
// supply of fair pairs from each pool. Reads the real files, so a data
// refresh that starves a question fails here rather than on the page.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { QUESTIONS, drawPair } from "../../site/js/game.js";
import { SCHEMA, checkData, checkDeep } from "../../site/js/data.js";
import { seeded } from "./random.mjs";

const read = (name) => JSON.parse(readFileSync(new URL(`../../data/${name}`, import.meta.url)));
const DATA = read("game.json");
const DEEP = read("deep.json");

// How many recent packages the page keeps out of the next draws, as in
// site/js/app.js.
const RECENT_LIMIT = 40;

// Tests the provenance block and that checkData accepts the file.
test("game.json has the schema and provenance the page shows", () => {
  assert.equal(DATA.schema, SCHEMA);
  assert.match(DATA.nixpkgs.rev, /^[0-9a-f]{40}$/);
  assert.match(DATA.multiverse.rev, /^[0-9a-f]{40}$/);
  assert.equal(checkData(DATA), DATA);
  assert.equal(checkDeep(DATA, DEEP), DEEP);
});

// Tests the tier sizes the page shows against the files, and that the two
// tiers do not overlap.
test("tiers add up", () => {
  assert.equal(DATA.packages.length, DATA.tiers.common);
  assert.equal(DATA.packages.length + DEEP.packages.length, DATA.tiers.deep);
  const common = new Set(DATA.packages.map((p) => p.attr));
  assert.ok(DEEP.packages.every((p) => !common.has(p.attr)));
});

// Tests the proof fields: a store path on every package, and a witness
// dependent exactly when something depends on the package.
test("every package carries its proof", () => {
  for (const p of [...DATA.packages, ...DEEP.packages]) {
    assert.match(p.out, /^\/nix\/store\/[0-9a-z]{32}-/, p.attr);
    assert.equal(p.witness === null, p.rebuilds === 0, p.attr);
  }
});

// Tests that each question can be asked of most of the pool.
test("most packages have every value", () => {
  for (const type of Object.keys(QUESTIONS)) {
    const field = QUESTIONS[type].field;
    const have = DATA.packages.filter((p) => p[field] !== null).length;
    assert.ok(have >= DATA.packages.length * 0.9, `${type}: ${have}`);
  }
});

// Tests that the common pool can keep drawing with a long exclusion list.
test("common draws never run dry", () => {
  const random = seeded(1);
  const recent = new Set(DATA.packages.slice(0, 100).map((p) => p.attr));
  for (const type of Object.keys(QUESTIONS)) {
    for (let i = 0; i < 200; i++) {
      assert.ok(drawPair(DATA.packages, type, random, recent), type);
    }
  }
});

// Tests that the deep-cuts pool, which is deep.json alone, can keep
// drawing fair pairs for every question with the recent packages
// excluded.
test("deep-cuts draws never run dry", () => {
  const random = seeded(2);
  const recent = new Set(DEEP.packages.slice(0, RECENT_LIMIT).map((p) => p.attr));
  for (const type of Object.keys(QUESTIONS)) {
    for (let i = 0; i < 50; i++) {
      assert.ok(drawPair(DEEP.packages, type, random, recent), type);
    }
  }
});
