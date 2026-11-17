// Tests for site/js/verify.js, which proves a revealed number: the
// commands a player can run, with the output they should print, and the
// in-browser walk of cache.nixos.org's narinfos. The walk is driven by a
// made-up cache in a Map, so these tests need no network; live.test.mjs
// runs the same walk against the real cache when asked to.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  mvsCommand,
  mvsHeader,
  multiverseUrl,
  narinfoUrl,
  parseNarinfo,
  pathInfoCommand,
  pathInfoOutput,
  walkClosure,
  whyDependsCommand,
} from "../../site/js/verify.js";

const REV = "6dadaf4375be35033e1c84395adbd53ff5fded96";
const MV_REV = "0e0b03cad7c24221d3e59b886bc74d1af5f71d3c";
const LIBNDP = "/nix/store/97q15lk5c0c10miyawwbfir4rddifcqn-libndp-1.9";

// Tests each command and expected output against what was run by hand:
// `nix path-info -S` prints the path, a tab, and the size right-aligned in
// eleven columns, and mvs starts with `<attr> · <n> versions · <first> ..`.
test("commands and their expected output", () => {
  assert.equal(
    pathInfoCommand(LIBNDP),
    `nix path-info -S --store https://cache.nixos.org ${LIBNDP}`,
  );
  assert.equal(pathInfoOutput(LIBNDP, 38322544), `${LIBNDP}\t   38322544`);
  assert.equal(
    whyDependsCommand(REV, "vscodium", "libndp"),
    `nix why-depends --derivation github:NixOS/nixpkgs/${REV}#vscodium github:NixOS/nixpkgs/${REV}#libndp`,
  );
  assert.equal(
    mvsCommand(MV_REV, "libndp"),
    `nix run github:fzakaria/nixpkgs-multiverse/${MV_REV}#mvs -- query versions libndp`,
  );
  assert.equal(mvsHeader("libndp", 4, "2016-09-24"), "libndp · 4 versions · 2016-09-24 ..");
  assert.equal(mvsHeader("x", 1, "2020-01-01"), "x · 1 version · 2020-01-01 ..");
  assert.equal(multiverseUrl("libndp"), "https://nixmultiverse.com/?pkg=libndp");
  assert.equal(
    narinfoUrl(LIBNDP),
    "https://cache.nixos.org/97q15lk5c0c10miyawwbfir4rddifcqn.narinfo",
  );
});

// Tests that a narinfo's size and references come out as numbers and full
// store paths.
test("parseNarinfo", () => {
  const text = "StorePath: /nix/store/aaaa-app\nNarSize: 100\nReferences: aaaa-app bbbb-lib\n";
  assert.deepEqual(parseNarinfo(text), {
    narSize: 100,
    references: ["/nix/store/aaaa-app", "/nix/store/bbbb-lib"],
  });
  assert.deepEqual(parseNarinfo("NarSize: 7\nReferences: \n"), { narSize: 7, references: [] });
});

function narinfo(name, size, refs) {
  return `StorePath: /nix/store/${name}\nNarSize: ${size}\nReferences: ${refs.join(" ")}\n`;
}

// A cache of a dozen paths: an app, ten libraries it uses, and a libc
// they all share.
const CACHE = new Map([
  ["aaaa-app", narinfo("aaaa-app", 100, ["aaaa-app", ...range(10).map((i) => `l${i}-lib`)])],
]);
for (const i of range(10)) {
  CACHE.set(`l${i}-lib`, narinfo(`l${i}-lib`, 10, ["cccc-libc"]));
}
CACHE.set("cccc-libc", narinfo("cccc-libc", 1, []));

function range(n) {
  return Array.from({ length: n }, (_, i) => i);
}

// Tests the sum, that every narinfo is fetched once, and that no more
// than `concurrency` requests are ever in flight.
test("walkClosure sums NarSize breadth-first under a concurrency cap", async () => {
  const fetched = [];
  let inFlight = 0;
  let most = 0;
  const fetchText = async (path) => {
    fetched.push(path);
    inFlight++;
    most = Math.max(most, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    return CACHE.get(path.slice("/nix/store/".length)) ?? null;
  };
  const progress = [];
  const result = await walkClosure("/nix/store/aaaa-app", fetchText, {
    concurrency: 3,
    onProgress: (p) => progress.push(p),
  });
  assert.deepEqual(result, { paths: 12, bytes: 100 + 10 * 10 + 1 });
  assert.equal(fetched.length, new Set(fetched).size);
  assert.ok(most <= 3, `${most} in flight`);
  assert.ok(most > 1, "requests overlap");
  assert.deepEqual(progress.at(-1), { paths: 12, bytes: 201 });
});

// Tests that a path the cache lacks is an error naming it, not a smaller
// total.
test("walkClosure fails on a missing path", async () => {
  const fetchText = async (path) =>
    path.endsWith("aaaa-app") ? narinfo("aaaa-app", 1, ["zzzz-gone"]) : null;
  await assert.rejects(walkClosure("/nix/store/aaaa-app", fetchText), /zzzz-gone/);
});
