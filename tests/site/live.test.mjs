// Runs site/js/verify.js' closure walk against the real cache.nixos.org
// and compares it with the closure size the pipeline recorded. Needs the
// network, so it is skipped unless NHL_LIVE=1, and the flake's checks,
// which run in the sandbox, never set it:
//
//   NHL_LIVE=1 node --test tests/site/live.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { fetchNarinfo, walkClosure } from "../../site/js/verify.js";

const DATA = JSON.parse(readFileSync(new URL("../../data/game.json", import.meta.url)));
const LIVE = process.env.NHL_LIVE === "1";

// Packages to walk: the one the user checked by hand, and two larger ones.
const ATTRS = ["libndp", "python3", "firefox"];

for (const attr of ATTRS) {
  // Tests that the browser walk reproduces the recorded closure size.
  test(`live closure walk of ${attr}`, { skip: !LIVE }, async () => {
    const p = DATA.packages.find((x) => x.attr === attr);
    const result = await walkClosure(p.out, fetchNarinfo);
    console.log(`${attr}: ${p.out} ${result.paths} paths ${result.bytes} bytes`);
    assert.equal(result.bytes, p.closureSize);
  });
}
