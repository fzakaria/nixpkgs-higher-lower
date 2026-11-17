// The game's rules, free of the DOM so node can test them: which
// questions exist, which pairs are fair to ask, who wins, and how the
// daily game draws the same ten rounds for everyone on the same date.

// One entry per question. `field` is the package's key in game.json.
// `ask` is the question as the page shows it. `min` and `max` bound how
// lopsided a pair may be: a ratio of the two values for counts and sizes
// (counts compare as count+1, so a zero still has a ratio), and a gap in
// days between the two first-seen windows for dates.
export const QUESTIONS = {
  rebuilds: {
    field: "rebuilds",
    ask: "Which would rebuild more of nixpkgs if it changed?",
    min: 1.2,
    max: 25,
  },
  closureSize: {
    field: "closureSize",
    ask: "Which has the bigger runtime closure?",
    min: 1.2,
    max: 10,
  },
  versions: {
    field: "versions",
    ask: "Which has shipped more versions in nixpkgs?",
    // Versions are small integers, so the floor is a difference of two
    // rather than a ratio, and the ceiling stays a ratio.
    minDiff: 2,
    max: 5,
  },
  firstSeen: {
    field: "firstSeen",
    ask: "Which was packaged first?",
    min: 180,
    max: 3650,
  },
};

// The daily game: how many rounds of each question, before shuffling.
// Rebuilds is the headline stat, so it gets the most.
export const DAILY_MIX = [
  "rebuilds",
  "rebuilds",
  "rebuilds",
  "rebuilds",
  "closureSize",
  "closureSize",
  "versions",
  "versions",
  "firstSeen",
  "firstSeen",
];

// The first daily game; puzzle numbers count from it.
export const LAUNCH_DATE = "2026-11-16";

// How many times drawPair tries a first package before giving up.
const DRAW_ATTEMPTS = 64;

const DAY_MS = 86_400_000;

// Characters in the share line for a right and a wrong answer.
const RIGHT_MARK = "+";
const WRONG_MARK = "-";

// 32-bit FNV-1a of a string's UTF-16 code units. Seeds the daily draw
// from the date.
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32: a small seeded generator, the same sequence in every
// browser, returning floats in [0, 1).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Days since the Unix epoch for a YYYY-MM-DD date.
function dayNumber(date) {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

// Whether the package has a value for this question.
export function hasValue(type, p) {
  const v = p[QUESTIONS[type].field];
  return v !== null && v !== undefined;
}

// Whether a and b make a question worth asking: both have a value, the
// answer is certain, and it is neither a coin flip nor a blowout.
export function fair(type, a, b) {
  if (!hasValue(type, a) || !hasValue(type, b)) {
    return false;
  }
  const q = QUESTIONS[type];

  // First-seen dates are windows. Only windows that do not overlap have
  // an answer, and the gap between them is what the bounds apply to.
  if (type === "firstSeen") {
    const [early, late] = winner(type, a, b) === 0 ? [a, b] : [b, a];
    if (late.firstSeen.after === null) {
      return false;
    }
    const gap = dayNumber(late.firstSeen.after) - dayNumber(early.firstSeen.by);
    return gap >= q.min && gap <= q.max;
  }

  const x = a[q.field];
  const y = b[q.field];
  if (q.minDiff !== undefined) {
    const ratio = Math.max(x, y) / Math.max(1, Math.min(x, y));
    return Math.abs(x - y) >= q.minDiff && ratio <= q.max;
  }
  const ratio = (Math.max(x, y) + 1) / (Math.min(x, y) + 1);
  return ratio >= q.min && ratio <= q.max;
}

// 0 if a is the answer, 1 if b is. For first-seen the answer is whichever
// was in nixpkgs earlier; for the rest, the larger number.
export function winner(type, a, b) {
  if (type === "firstSeen") {
    return a.firstSeen.by <= b.firstSeen.by ? 0 : 1;
  }
  const field = QUESTIONS[type].field;
  return a[field] >= b[field] ? 0 : 1;
}

// A fair pair for one question, in random order, drawn with `random`
// from packages not in `exclude`. null if no fair pair turned up.
export function drawPair(packages, type, random, exclude = new Set()) {
  const eligible = packages.filter((p) => hasValue(type, p) && !exclude.has(p.attr));
  if (eligible.length < 2) {
    return null;
  }

  for (let attempt = 0; attempt < DRAW_ATTEMPTS; attempt++) {
    const a = eligible[Math.floor(random() * eligible.length)];
    const partners = eligible.filter((b) => b !== a && fair(type, a, b));
    if (partners.length === 0) {
      continue;
    }
    const b = partners[Math.floor(random() * partners.length)];
    return random() < 0.5 ? [a, b] : [b, a];
  }
  return null;
}

// Fisher-Yates with the given generator, on a copy.
function shuffle(items, random) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// The daily game for a YYYY-MM-DD date: DAILY_MIX shuffled, one pair per
// question, no package twice. The seed is the date alone, so everyone
// with the same data gets the same rounds.
export function dailyRounds(packages, date) {
  const random = mulberry32(hashString(`rebuild-higher-lower:${date}`));
  const used = new Set();
  const rounds = [];
  for (const type of shuffle(DAILY_MIX, random)) {
    const pair = drawPair(packages, type, random, used);
    if (!pair) {
      continue;
    }
    const [a, b] = pair;
    used.add(a.attr);
    used.add(b.attr);
    rounds.push({ type, a, b });
  }
  return rounds;
}

// The puzzle number for a date: 1 on LAUNCH_DATE.
export function dailyNumber(date) {
  return dayNumber(date) - dayNumber(LAUNCH_DATE) + 1;
}

// The line a player copies after a daily game.
export function shareText(date, results, url) {
  const right = results.filter(Boolean).length;
  const marks = results.map((r) => (r ? RIGHT_MARK : WRONG_MARK)).join("");
  return `Rebuild Higher or Lower #${dailyNumber(date)} ${date}: ${right}/${results.length} ${marks} ${url}`;
}

// The endless game's question for its next round, weighted like the
// daily mix.
export function randomType(random) {
  return DAILY_MIX[Math.floor(random() * DAILY_MIX.length)];
}
