// Tests for site/js/format.js: how each stat is written on a card once it
// is revealed. Plain values in, exact strings out.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatBytes,
  formatCount,
  formatDependents,
  formatLiveResult,
  formatStat,
  monthYear,
} from "../../site/js/format.js";

// Tests digit grouping, which must not depend on the browser's locale.
test("formatCount groups thousands with commas", () => {
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(999), "999");
  assert.equal(formatCount(89094), "89,094");
  assert.equal(formatCount(1234567), "1,234,567");
});

// Tests binary units at each step, with one decimal below 100.
test("formatBytes uses binary units", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(49407592), "47.1 MiB");
  assert.equal(formatBytes(345 * 1024 * 1024), "345 MiB");
  assert.equal(formatBytes(1.25 * 1024 ** 3), "1.3 GiB");
});

// Tests month names, fixed in English rather than taken from the locale.
test("monthYear names the month", () => {
  assert.equal(monthYear("2016-09-24"), "Sep 2016");
  assert.equal(monthYear("2012-07-05"), "Jul 2012");
});

// Tests each question's revealed value, including the singular forms and
// the three shapes a first-seen window takes.
test("formatStat writes each question's value", () => {
  assert.equal(formatStat("rebuilds", { rebuilds: 65420 }), "65,420 rebuilds");
  assert.equal(formatStat("rebuilds", { rebuilds: 1 }), "1 rebuild");
  assert.equal(formatStat("closureSize", { closureSize: 2048 }), "2.0 KiB");
  assert.equal(formatStat("versions", { versions: 47 }), "47 versions");
  assert.equal(formatStat("versions", { versions: 1 }), "1 version");
  assert.equal(
    formatStat("firstSeen", { firstSeen: { after: null, by: "2012-07-05" } }),
    "by Jul 2012",
  );
  assert.equal(
    formatStat("firstSeen", { firstSeen: { after: "2018-03-01", by: "2018-03-08" } }),
    "Mar 2018",
  );
  assert.equal(
    formatStat("firstSeen", { firstSeen: { after: "2013-10-31", by: "2016-09-24" } }),
    "Oct 2013 to Sep 2016",
  );
});

// Tests the line under a rebuild count: the named dependents, then how
// many more, and nothing when no names are known.
test("formatDependents names a few and counts the rest", () => {
  assert.equal(
    formatDependents(["firefox", "mpv", "pavucontrol"], 4815),
    "includes firefox, mpv, pavucontrol and 4,812 others",
  );
  assert.equal(formatDependents(["firefox", "mpv"], 3), "includes firefox, mpv and 1 other");
  assert.equal(formatDependents(["firefox", "mpv"], 2), "includes firefox and mpv");
  assert.equal(formatDependents(["firefox"], 1), "includes firefox");
  assert.equal(formatDependents([], 0), null);
});

// Tests the inline result of the live closure walk, matching and not.
test("formatLiveResult compares the walk with the recorded size", () => {
  const recorded = 48_234_496;
  assert.equal(
    formatLiveResult({ paths: 6, bytes: recorded }, recorded),
    "cache.nixos.org: 6 paths, 46.0 MiB, matches",
  );
  assert.equal(
    formatLiveResult({ paths: 1, bytes: 100 }, 90),
    "cache.nixos.org: 1 path, 100 bytes, recorded 90",
  );
});
