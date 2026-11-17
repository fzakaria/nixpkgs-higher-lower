// Tests the committed data/game.json and data/deep.json against what the
// page needs: the schema data.js accepts, the proof fields every reveal
// shows, a value for every question on most packages, and a full daily
// game on every date for the next two years. Reads the real files, so a
// data refresh that starves a question fails here rather than on the
// page.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { QUESTIONS, dailyRounds, drawPair, fair, mulberry32 } from "../../site/js/game.js";
import { SCHEMA, checkData, checkDeep } from "../../site/js/data.js";

const read = (name) => JSON.parse(readFileSync(new URL(`../../data/${name}`, import.meta.url)));
const DATA = read("game.json");
const DEEP = read("deep.json");

// How many days of daily games to draw.
const DAYS = 731;
const DAY_MS = 86_400_000;

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

// Tests a full, fair, repeat-free daily game for every date in two years.
test("every daily game for two years has ten fair rounds", () => {
  const start = Date.parse("2026-11-16T00:00:00Z");
  for (let i = 0; i < DAYS; i++) {
    const date = new Date(start + i * DAY_MS).toISOString().slice(0, 10);
    const rounds = dailyRounds(DATA.packages, date);
    assert.equal(rounds.length, 10, date);
    for (const r of rounds) {
      assert.ok(fair(r.type, r.a, r.b), `${date} ${r.type} ${r.a.attr} ${r.b.attr}`);
    }
  }
});

// Tests that the endless game can keep drawing with a long exclusion list.
test("endless draws never run dry", () => {
  const random = mulberry32(1);
  const recent = new Set(DATA.packages.slice(0, 100).map((p) => p.attr));
  for (const type of Object.keys(QUESTIONS)) {
    for (let i = 0; i < 200; i++) {
      assert.ok(drawPair(DATA.packages, type, random, recent), type);
    }
  }
});

// Tests that the deep-cuts tier can keep drawing fair pairs for every
// question with the endless game's recent packages excluded.
test("deep-cuts draws never run dry", () => {
  const all = [...DATA.packages, ...DEEP.packages];
  const random = mulberry32(2);
  const recent = new Set(all.slice(0, 40).map((p) => p.attr));
  for (const type of Object.keys(QUESTIONS)) {
    for (let i = 0; i < 50; i++) {
      assert.ok(drawPair(all, type, random, recent), type);
    }
  }
});
