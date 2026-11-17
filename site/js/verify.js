// Proof for a revealed number: the command that reproduces it, with the
// output it prints, and for closure sizes a walk of cache.nixos.org's
// narinfos run in the browser. cache.nixos.org answers with
// `access-control-allow-origin: *`, so a static page can fetch them.

export const CACHE_URL = "https://cache.nixos.org";

const STORE = "/nix/store/";

// `nix path-info -S` right-aligns the closure size in this many columns
// after a tab.
const PATH_INFO_SIZE_WIDTH = 11;

// How many narinfo requests the live walk keeps in flight.
export const WALK_CONCURRENCY = 8;

const HTTP_NOT_FOUND = 404;

export function pathInfoCommand(out) {
  return `nix path-info -S --store ${CACHE_URL} ${out}`;
}

export function pathInfoOutput(out, size) {
  return `${out}\t${String(size).padStart(PATH_INFO_SIZE_WIDTH)}`;
}

export function whyDependsCommand(rev, dependent, attr) {
  const flake = `github:NixOS/nixpkgs/${rev}`;
  return `nix why-depends --derivation ${flake}#${dependent} ${flake}#${attr}`;
}

export function mvsCommand(rev, attr) {
  return `nix run github:fzakaria/nixpkgs-multiverse/${rev}#mvs -- query versions ${attr}`;
}

// The start of the first line `mvs query versions` prints. The line goes
// on to the last date the attribute was seen, which this page does not
// record.
export function mvsHeader(attr, versions, first) {
  const noun = versions === 1 ? "version" : "versions";
  return `${attr} · ${versions} ${noun} · ${first} ..`;
}

export function multiverseUrl(attr) {
  return `https://nixmultiverse.com/?pkg=${encodeURIComponent(attr)}`;
}

export function narinfoUrl(path) {
  const hash = path.slice(STORE.length).split("-", 1)[0];
  return `${CACHE_URL}/${hash}.narinfo`;
}

// A narinfo's NarSize, and its references as full store paths.
export function parseNarinfo(text) {
  let narSize = null;
  let references = [];
  for (const line of text.split("\n")) {
    const at = line.indexOf(": ");
    if (at < 0) {
      continue;
    }
    const key = line.slice(0, at);
    const value = line.slice(at + 2).trim();
    if (key === "NarSize") {
      narSize = Number(value);
      continue;
    }
    if (key === "References") {
      references = value ? value.split(/\s+/).map((r) => STORE + r) : [];
    }
  }
  return { narSize, references };
}

// The narinfo text for a store path from cache.nixos.org, or null if the
// cache does not have it.
export async function fetchNarinfo(path) {
  const response = await fetch(narinfoUrl(path));
  if (response.status === HTTP_NOT_FOUND) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`${narinfoUrl(path)}: HTTP ${response.status}`);
  }
  return response.text();
}

// Walk the runtime closure of `root` breadth-first through narinfos, at
// most `concurrency` fetches at a time, and sum NarSize. Resolves to
// { paths, bytes }; rejects if any path is missing from the cache.
// `onProgress` gets the running totals after every narinfo.
export async function walkClosure(
  root,
  fetchText = fetchNarinfo,
  { concurrency = WALK_CONCURRENCY, onProgress = () => {} } = {},
) {
  const seen = new Set([root]);
  const queue = [root];
  let head = 0;
  let paths = 0;
  let bytes = 0;

  // Each worker takes the next queued path until the queue is empty and
  // no other worker can add to it.
  let active = 0;
  let wake = null;
  async function worker() {
    for (;;) {
      if (head >= queue.length) {
        if (active === 0) {
          return;
        }
        // Wait for a busy worker to queue more paths or finish.
        await new Promise((r) => (wake = wake ? chain(wake, r) : r));
        continue;
      }
      const path = queue[head++];
      active++;
      try {
        const text = await fetchText(path);
        if (text === null) {
          throw new Error(`${path} is not in ${CACHE_URL}`);
        }
        const info = parseNarinfo(text);
        paths++;
        bytes += info.narSize;
        for (const ref of info.references) {
          if (!seen.has(ref)) {
            seen.add(ref);
            queue.push(ref);
          }
        }
        onProgress({ paths, bytes });
      } finally {
        active--;
        const w = wake;
        wake = null;
        w?.();
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return { paths, bytes };
}

// Two resolvers as one, so every waiting worker wakes.
function chain(a, b) {
  return () => {
    a();
    b();
  };
}
