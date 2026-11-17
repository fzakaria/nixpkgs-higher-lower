// The page: three modes over the rules in game.js. The daily game is the
// date's ten rounds from the common pool, resumable after a reload. The
// endless game draws rounds until the first wrong answer and keeps the
// best streak, from the common pool or from the deep-cuts tier, which is
// loaded only when picked.

import { loadData, loadDeep } from "./data.js";
import { formatCount, formatStat, monthYear } from "./format.js";
import {
  QUESTIONS,
  dailyNumber,
  dailyRounds,
  drawPair,
  hashString,
  mulberry32,
  randomType,
  shareText,
  winner,
} from "./game.js";
import { copyText, proofPanel } from "./proof.js";

// The deployed page, for the share line.
const SITE_URL = "https://fzakaria.github.io/rebuild-higher-lower/";

// The endless game keeps this many recent packages out of the next draws.
const RECENT_LIMIT = 40;

// localStorage keys. The best streak is kept per endless tier.
const DAILY_KEY = "rhl-daily";
const BEST_KEY = { endless: "rhl-best", deep: "rhl-best-deep" };

const MODES = { daily: "daily", endless: "endless", deep: "deep" };

const $ = (id) => document.getElementById(id);

let data = null;

// The deep tier's packages, common pool included, once fetched.
let deepPackages = null;

let mode = MODES.daily;

// The round on screen: { type, a, b, picked } where picked is null until
// the player answers.
let round = null;

// Daily progress: the date and one boolean per answered round.
let daily = { date: null, rounds: [], results: [] };

// Endless progress, for whichever tier is being played.
let endless = { packages: [], random: null, recent: [], streak: 0, best: 0 };

// localStorage, wrapped: private windows and blocked storage throw, and
// the game must still work without it.
function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Progress is a convenience; losing it on reload is acceptable.
  }
}

// Today in the player's own calendar, as YYYY-MM-DD.
function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Draw one card's static content: the name, version and description.
function fillCard(card, p) {
  card.querySelector(".attr").textContent = p.attr;
  card.querySelector(".version").textContent = p.version ?? "";
  card.querySelector(".desc").textContent = p.description ?? "";
  card.querySelector(".stat").textContent = "";
  card.classList.remove("right", "wrong", "higher");
  card.disabled = false;
}

function showRound() {
  const q = QUESTIONS[round.type];
  $("question").textContent = q.ask;
  const cards = document.querySelectorAll(".card");
  fillCard(cards[0], round.a);
  fillCard(cards[1], round.b);
  $("proofs").replaceChildren();
  $("proofs").hidden = true;
  $("after").hidden = true;
  $("game").hidden = false;
  $("done").hidden = true;
  cards[0].focus({ preventScroll: true });
}

// Reveal both numbers and their proofs, mark the answer, and record the
// result.
function pick(side) {
  if (!round || round.picked !== null) {
    return;
  }
  round.picked = side;
  const answer = winner(round.type, round.a, round.b);
  const right = side === answer;

  // Both stats, the higher card outlined, the picked card coloured, and
  // under them how to check each number.
  const cards = document.querySelectorAll(".card");
  [round.a, round.b].forEach((p, i) => {
    cards[i].querySelector(".stat").textContent = formatStat(round.type, p);
    cards[i].disabled = true;
  });
  cards[answer].classList.add("higher");
  cards[side].classList.add(right ? "right" : "wrong");
  $("verdict").textContent = right ? "Right." : "Wrong.";
  $("verdict").className = right ? "right" : "wrong";
  $("proofs").replaceChildren(
    proofPanel(round.type, round.a, data),
    proofPanel(round.type, round.b, data),
  );
  $("proofs").hidden = false;

  if (mode === MODES.daily) {
    daily.results.push(right);
    save(DAILY_KEY, { date: daily.date, results: daily.results });
    const last = daily.results.length === daily.rounds.length;
    $("next").textContent = last ? "See the result" : "Next";
  } else {
    endless.streak = right ? endless.streak + 1 : 0;
    endless.best = Math.max(endless.best, endless.streak);
    save(BEST_KEY[mode], endless.best);
    $("next").textContent = right ? "Next" : "Start again";
  }
  showStatus();
  $("after").hidden = false;
  $("next").focus({ preventScroll: true });
}

function showStatus() {
  if (mode === MODES.daily) {
    const right = daily.results.filter(Boolean).length;
    const n = Math.min(
      daily.results.length + (round?.picked === null ? 1 : 0),
      daily.rounds.length,
    );
    $("status").textContent =
      `Daily #${dailyNumber(daily.date)} · round ${n} of ${daily.rounds.length} · ${right} right`;
    return;
  }
  $("status").textContent = `Streak ${endless.streak} · best ${endless.best}`;
}

// What each mode draws from, in words, with the pool's size.
function showPoolNote() {
  const common = formatCount(data.tiers.common);
  const deep = formatCount(data.tiers.deep);
  const more = formatCount(data.tiers.deep - data.tiers.common);
  const notes = {
    daily: `Ten rounds from the common pool of ${common} packages, the same for everyone today.`,
    endless: `Rounds from the common pool of ${common} packages until the first wrong answer.`,
    deep:
      `Rounds from ${deep} packages until the first wrong answer: the common pool and ` +
      `${more} more, ranked by rebuild count and then by how many versions nixpkgs has shipped.`,
  };
  $("pool-note").textContent = notes[mode];
}

// The daily game: resume today's answers if any, else start at round one.
function startDaily() {
  const date = today();
  const saved = load(DAILY_KEY);
  daily = {
    date,
    rounds: dailyRounds(data.packages, date),
    results: saved?.date === date && Array.isArray(saved.results) ? saved.results : [],
  };
  nextDaily();
}

function nextDaily() {
  if (daily.results.length >= daily.rounds.length) {
    round = null;
    showDone();
    return;
  }
  round = { ...daily.rounds[daily.results.length], picked: null };
  showStatus();
  showRound();
}

// The end of a daily game: the score, each round's line, the share text.
function showDone() {
  showStatus();
  $("game").hidden = true;
  $("done").hidden = false;
  const right = daily.results.filter(Boolean).length;
  $("score").textContent =
    `${right} of ${daily.rounds.length} right. A new game starts at midnight.`;

  const list = $("recap");
  list.replaceChildren();
  daily.rounds.forEach((r, i) => {
    const li = document.createElement("li");
    li.className = daily.results[i] ? "right" : "wrong";
    const w = winner(r.type, r.a, r.b);
    const [hi, lo] = w === 0 ? [r.a, r.b] : [r.b, r.a];
    li.textContent = `${QUESTIONS[r.type].ask} ${hi.attr} (${formatStat(r.type, hi)}) over ${lo.attr} (${formatStat(r.type, lo)})`;
    list.append(li);
  });
  $("share").value = shareText(daily.date, daily.results, SITE_URL);
}

// The endless game: seeded from the clock, so every run differs.
function startEndless(packages) {
  endless = {
    packages,
    random: mulberry32(hashString(String(Date.now()))),
    recent: [],
    streak: 0,
    best: Number(load(BEST_KEY[mode])) || 0,
  };
  nextEndless();
}

function nextEndless() {
  // A draw that finds no fair pair outside the recent packages forgets
  // them and draws again; tests/site/data.test.mjs shows the shipped data
  // never needs to.
  const type = randomType(endless.random);
  let pair = drawPair(endless.packages, type, endless.random, new Set(endless.recent));
  if (!pair) {
    endless.recent = [];
    pair = drawPair(endless.packages, type, endless.random);
  }
  const [a, b] = pair;
  endless.recent.push(a.attr, b.attr);
  endless.recent = endless.recent.slice(-RECENT_LIMIT);
  round = { type, a, b, picked: null };
  showStatus();
  showRound();
}

function next() {
  if (mode === MODES.daily) {
    nextDaily();
    return;
  }
  nextEndless();
}

// The deep tier, fetched once on first use.
async function deep() {
  if (!deepPackages) {
    $("status").textContent = `Loading ${formatCount(data.tiers.deep)} packages…`;
    const extra = await loadDeep(data);
    deepPackages = [...data.packages, ...extra.packages];
  }
  return deepPackages;
}

// Switch modes from the tabs or the URL hash.
async function setMode(m) {
  mode = Object.values(MODES).includes(m) ? m : MODES.daily;
  const tab = mode === MODES.daily ? MODES.daily : MODES.endless;
  for (const a of document.querySelectorAll("#modes a")) {
    a.classList.toggle("active", a.dataset.mode === tab);
  }
  for (const a of document.querySelectorAll("#tiers a")) {
    a.classList.toggle("active", a.dataset.mode === mode);
  }
  $("tiers").hidden = mode === MODES.daily;
  showPoolNote();
  round = null;

  if (mode === MODES.daily) {
    startDaily();
    return;
  }
  if (mode === MODES.endless) {
    startEndless(data.packages);
    return;
  }
  try {
    startEndless(await deep());
  } catch (e) {
    $("status").textContent = `Could not load the deep-cuts data: ${e.message}`;
  }
}

// The footer's provenance line, and the revision and pool sizes the help
// text names, from the data file itself.
function showProvenance() {
  const n = data.nixpkgs;
  const mv = data.multiverse;
  const rev = `<a href="https://github.com/NixOS/nixpkgs/tree/${n.rev}"><code>${n.rev.slice(0, 12)}</code></a>`;
  $("provenance").innerHTML =
    `Rebuild counts and closures: nixpkgs ${rev} ` +
    `(${n.date}), ${data.system}, counted over ${formatCount(data.graph.universe)} packages. ` +
    `Versions and first-seen dates: <a href="https://nixmultiverse.com/">nixpkgs-multiverse</a>, ` +
    `${formatCount(mv.revisions)} nixos-unstable revisions from ${monthYear(mv.first)} to ${monthYear(mv.last)}.`;
  for (const node of document.querySelectorAll(".nixpkgs-rev")) {
    node.textContent = n.rev;
  }
  for (const node of document.querySelectorAll(".tier-common")) {
    node.textContent = formatCount(data.tiers.common);
  }
  for (const node of document.querySelectorAll(".tier-deep")) {
    node.textContent = formatCount(data.tiers.deep);
  }
}

function bind() {
  document
    .querySelectorAll(".card")
    .forEach((card, i) => card.addEventListener("click", () => pick(i)));
  $("next").addEventListener("click", next);
  $("copy").addEventListener("click", () =>
    copyText($("copy"), $("share").value, () => $("share").select()),
  );
  window.addEventListener("hashchange", () => setMode(location.hash.slice(1)));

  // 1 or the left arrow picks the left card, 2 or the right arrow the
  // right one; Enter moves on once the numbers are shown.
  document.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target.tagName === "TEXTAREA") {
      return;
    }
    if (round && round.picked === null) {
      if (e.key === "1" || e.key === "ArrowLeft") {
        pick(0);
      }
      if (e.key === "2" || e.key === "ArrowRight") {
        pick(1);
      }
      return;
    }
    if (round && e.key === "Enter" && document.activeElement.tagName !== "BUTTON") {
      next();
    }
  });
}

async function main() {
  bind();
  try {
    data = await loadData();
  } catch (e) {
    $("status").textContent = `Could not load the game data: ${e.message}`;
    $("status").classList.add("error");
    return;
  }
  showProvenance();
  setMode(location.hash.slice(1));
}

main();
