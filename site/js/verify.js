// Checking a revealed number: the multiverse page behind a version count
// or a first-seen date, and for closure sizes a walk of cache.nixos.org's
// narinfos run in the browser. cache.nixos.org answers with
// `access-control-allow-origin: *`, so a static page can fetch them.

export const CACHE_URL = "https://cache.nixos.org";

const STORE = "/nix/store/";

// How many narinfo requests the live walk keeps in flight.
export const WALK_CONCURRENCY = 8;

const HTTP_NOT_FOUND = 404;

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
