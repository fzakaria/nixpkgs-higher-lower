// The page: one endless game over the rules in game.js, drawing rounds
// until the first wrong answer and keeping the best streak. The player
// picks the pool, common or deep cuts; deep cuts is loaded only when
// picked, and the choice is remembered.

import { loadData, loadDeep } from "./data.js";
import { formatCount, formatStat } from "./format.js";
import { QUESTIONS, drawPair, randomType, winner } from "./game.js";
import { proofPanel } from "./proof.js";

// The game keeps this many recent packages out of the next draws.
const RECENT_LIMIT = 40;

// The pools a player can draw from.
const POOLS = { common: "common", deep: "deep" };

// localStorage keys: the chosen pool, and the best streak per pool.
const POOL_KEY = "nhl-pool";
const BEST_KEY = { [POOLS.common]: "nhl-best-common", [POOLS.deep]: "nhl-best-deep" };

// nix/site.nix replaces this with the store path of the site build. Left
// as is when a checkout's site/ is served directly, and then not shown.
const STORE_PATH = "__STORE_PATH__";
const PLACEHOLDER_PREFIX = "__";

const NIXPKGS_TREE_URL = "https://github.com/NixOS/nixpkgs/tree/";
const MULTIVERSE_URL = "https://nixmultiverse.com/";

// How many characters of the nixpkgs revision the footer shows.
const SHORT_REV = 7;

const $ = (id) => document.getElementById(id);

let data = null;

// The deep-cuts packages, once fetched.
let deepPackages = null;

let pool = POOLS.common;

// The round on screen: { type, a, b, picked } where picked is null until
// the player answers.
let round = null;

// The game in progress on the current pool.
let game = { packages: [], recent: [], streak: 0, best: 0 };

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
    // The pool and the best streak are conveniences; losing them is fine.
  }
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
  $("question").textContent = QUESTIONS[round.type].ask;
  const cards = document.querySelectorAll(".card");
  fillCard(cards[0], round.a);
  fillCard(cards[1], round.b);
  $("proofs").replaceChildren();
  $("proofs").hidden = true;
  $("after").hidden = true;
  $("game").hidden = false;
  cards[0].focus({ preventScroll: true });
}

// Reveal both numbers and their proofs, mark the answer, and update the
// streak.
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

  // The streak, kept per pool.
  game.streak = right ? game.streak + 1 : 0;
  game.best = Math.max(game.best, game.streak);
  save(BEST_KEY[pool], game.best);
  $("next").textContent = right ? "Next" : "Start again";
  showStatus();
  $("after").hidden = false;
  $("next").focus({ preventScroll: true });
}

function showStatus() {
  $("status").textContent = `Streak ${game.streak} · best ${game.best}`;
}

// A new game on `packages`, with the pool's best streak.
function startGame(packages) {
  game = {
    packages,
    recent: [],
    streak: 0,
    best: Number(load(BEST_KEY[pool])) || 0,
  };
  next();
}

function next() {
  // A draw that finds no fair pair outside the recent packages forgets
  // them and draws again; tests/site/data.test.mjs shows the shipped data
  // never needs to.
  const type = randomType(Math.random);
  let pair = drawPair(game.packages, type, Math.random, new Set(game.recent));
  if (!pair) {
    game.recent = [];
    pair = drawPair(game.packages, type, Math.random);
  }
  const [a, b] = pair;
  game.recent.push(a.attr, b.attr);
  game.recent = game.recent.slice(-RECENT_LIMIT);
  round = { type, a, b, picked: null };
  showStatus();
  showRound();
}

// The deep-cuts packages, fetched once on first use.
async function deep() {
  if (!deepPackages) {
    $("status").textContent =
      `Loading ${formatCount(data.tiers.deep - data.tiers.common)} packages…`;
    deepPackages = (await loadDeep(data)).packages;
  }
  return deepPackages;
}

// Switch pools from the buttons or the saved choice, and start a game.
async function setPool(p) {
  pool = Object.values(POOLS).includes(p) ? p : POOLS.common;
  save(POOL_KEY, pool);
  for (const button of document.querySelectorAll("#pools button")) {
    button.setAttribute("aria-pressed", String(button.dataset.pool === pool));
  }
  round = null;

  // The common pool is in the data already loaded.
  if (pool === POOLS.common) {
    startGame(data.packages);
    return;
  }

  // Deep cuts is a second fetch, which can fail on its own.
  try {
    startGame(await deep());
  } catch (e) {
    $("status").textContent = `Could not load the deep-cuts data: ${e.message}`;
  }
}

// Open the section the URL's fragment names, when it sits inside the
// closed methods <details>, and scroll to it. The game is left alone.
function showSection() {
  const target = location.hash ? document.getElementById(location.hash.slice(1)) : null;
  if (!target) {
    return;
  }
  const details = target.closest("details");
  if (details) {
    details.open = true;
  }
  target.scrollIntoView();
}

// The footer's provenance line and the build's store path, and the pool
// sizes the buttons and the methods name, from the data file itself.
function showProvenance() {
  const n = data.nixpkgs;
  const mv = data.multiverse;
  const rev = `<a href="${NIXPKGS_TREE_URL}${n.rev}"><code>${n.rev.slice(0, SHORT_REV)}</code></a>`;
  const years = `${mv.first.slice(0, 4)}–${mv.last.slice(0, 4)}`;
  $("provenance").innerHTML =
    `nixpkgs ${rev} (${n.date}), ${data.system}. ` +
    `Versions: <a href="${MULTIVERSE_URL}">nixpkgs-multiverse</a>, ${years}.`;

  // The store path, once the site build has filled it in.
  if (!STORE_PATH.startsWith(PLACEHOLDER_PREFIX)) {
    $("store-path").textContent = STORE_PATH;
    $("store").hidden = false;
  }

  // The pool sizes: deep cuts is the packages beyond the common pool.
  for (const node of document.querySelectorAll(".tier-common")) {
    node.textContent = formatCount(data.tiers.common);
  }
  for (const node of document.querySelectorAll(".tier-deep")) {
    node.textContent = formatCount(data.tiers.deep - data.tiers.common);
  }
}

function bind() {
  document
    .querySelectorAll(".card")
    .forEach((card, i) => card.addEventListener("click", () => pick(i)));
  $("next").addEventListener("click", next);
  for (const button of document.querySelectorAll("#pools button")) {
    button.addEventListener("click", () => setPool(button.dataset.pool));
  }
  window.addEventListener("hashchange", showSection);

  // 1 or the left arrow picks the left card, 2 or the right arrow the
  // right one; Enter moves on once the numbers are shown.
  document.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) {
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
  showSection();
  try {
    data = await loadData();
  } catch (e) {
    $("status").textContent = `Could not load the game data: ${e.message}`;
    $("status").classList.add("error");
    return;
  }
  showProvenance();
  setPool(load(POOL_KEY));
}

main();
