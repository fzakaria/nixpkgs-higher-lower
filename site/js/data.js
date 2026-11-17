// Loading the game's data. nix/site.nix renames game.json and deep.json to
// game.<hash>.json and deep.<hash>.json and rewrites the URLs below to
// match, so a deploy can never pair new code with a cached old data file.
//
// game.json is the common pool plus the provenance the footer shows.
// deep.json is the deep-cuts pool, fetched only when a player picks it.

export const SCHEMA = 2;

export const DATA_URL = "game.json";
export const DEEP_URL = "deep.json";

// The fields every package must carry; a value may be null.
const PACKAGE_FIELDS = [
  "attr",
  "out",
  "rebuilds",
  "witness",
  "closureSize",
  "versions",
  "firstSeen",
];

function checkPackages(packages) {
  if (!Array.isArray(packages) || packages.length < 2) {
    throw new Error("game data has no packages");
  }
  for (const p of packages) {
    for (const field of PACKAGE_FIELDS) {
      if (!(field in p)) {
        throw new Error(`package ${p.attr} has no ${field}`);
      }
    }
  }
}

// The parsed common data, or an Error naming what is wrong with it.
export function checkData(data) {
  if (data?.schema !== SCHEMA) {
    throw new Error(`game data has schema ${data?.schema}, this page reads ${SCHEMA}`);
  }
  checkPackages(data.packages);
  return data;
}

// The parsed deep tier, which must come from the same nixpkgs as `data`.
export function checkDeep(data, deep) {
  if (deep?.schema !== SCHEMA || deep.nixpkgs?.rev !== data.nixpkgs.rev) {
    throw new Error("deep-cuts data does not match the game data");
  }
  checkPackages(deep.packages);
  return deep;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return response.json();
}

export async function loadData() {
  return checkData(await fetchJson(DATA_URL));
}

export async function loadDeep(data) {
  return checkDeep(data, await fetchJson(DEEP_URL));
}
