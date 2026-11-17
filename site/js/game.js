// The game's rules, free of the DOM so node can test them: which
// questions exist, how often each comes up, which pairs are fair to ask,
// and who wins.

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

// How often each question comes up: one entry per share of the draw.
// Rebuilds is the headline stat, so it gets the most.
export const ROUND_MIX = [
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

// How many times drawPair tries a first package before giving up.
const DRAW_ATTEMPTS = 64;

const DAY_MS = 86_400_000;

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
// (any function returning floats in [0, 1), such as Math.random) from
// packages not in `exclude`. null if no fair pair turned up.
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

// The question for the next round, drawn with `random` from ROUND_MIX.
export function randomType(random) {
  return ROUND_MIX[Math.floor(random() * ROUND_MIX.length)];
}
