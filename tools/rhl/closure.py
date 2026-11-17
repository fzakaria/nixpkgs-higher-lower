"""Runtime closure sizes from a binary cache's narinfos.

`nix path-info -S --store https://cache.nixos.org` computes the same
number, but stops at the first path the cache does not have, and the pool
has unfree packages Hydra never builds. Walking the narinfos here gives
those a None instead.
"""

import http.client
import threading
import time
from concurrent.futures import ThreadPoolExecutor

STORE = "/nix/store/"
CACHE_HOST = "cache.nixos.org"

# A walk is tens of thousands of requests, and the CDN resets the odd
# connection; each request gets this many tries, backing off a second more
# each time.
FETCH_TRIES = 5

HTTP_OK = 200
HTTP_NOT_FOUND = 404
TIMEOUT_SECONDS = 60

# One keep-alive connection per worker thread, so a walk costs one DNS
# lookup and one TLS handshake per thread rather than one per narinfo.
_local = threading.local()


def _connection():
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = http.client.HTTPSConnection(CACHE_HOST, timeout=TIMEOUT_SECONDS)
        _local.conn = conn
    return conn


def parse_narinfo(text):
    """(NarSize, references as full store paths) from a narinfo."""
    size = None
    refs = []
    for line in text.splitlines():
        key, _, value = line.partition(": ")
        if key == "NarSize":
            size = int(value)
            continue
        if key == "References":
            refs = [STORE + r for r in value.split()]
    return size, refs


def fetch_narinfo(path):
    """The narinfo text for a store path, or None if the cache lacks it."""
    digest = path.removeprefix(STORE).split("-", 1)[0]
    for attempt in range(FETCH_TRIES):
        try:
            conn = _connection()
            conn.request("GET", f"/{digest}.narinfo")
            r = conn.getresponse()
            body = r.read()
            if r.status == HTTP_OK:
                return body.decode()
            if r.status == HTTP_NOT_FOUND:
                return None
            error = RuntimeError(f"{path}: HTTP {r.status}")
        except (OSError, http.client.HTTPException) as e:
            error = e

        # Start the next try on a fresh connection.
        _local.conn.close()
        _local.conn = None
        if attempt == FETCH_TRIES - 1:
            raise error
        time.sleep(attempt + 1)


def closure_sizes(roots, fetch=fetch_narinfo, threads=32, info=None):
    """{root: bytes of its runtime closure, or None if the cache lacks the
    root}. Every narinfo is fetched once, a level of the walk at a time.

    `info` maps store paths to parsed narinfos (None for absent) and is
    filled in as the walk goes; pass the same dict again and the next walk
    fetches only paths it does not hold."""
    if info is None:
        info = {}
    frontier = [r for r in dict.fromkeys(roots) if r not in info]
    with ThreadPoolExecutor(max_workers=threads) as pool:
        while frontier:
            for path, text in zip(frontier, pool.map(fetch, frontier)):
                info[path] = parse_narinfo(text) if text is not None else None

            nxt = {}
            for path in frontier:
                if info[path] is None:
                    continue
                for ref in info[path][1]:
                    if ref not in info:
                        nxt[ref] = None
            frontier = list(nxt)

    sizes = {}
    for root in roots:
        sizes[root] = closure_size(root, info)
    return sizes


def closure_size(root, info):
    """Sum of NarSize over the closure of `root`, or None if any path in it
    is missing from `info`."""
    seen = set()
    stack = [root]
    total = 0
    while stack:
        path = stack.pop()
        if path in seen:
            continue
        seen.add(path)

        entry = info.get(path)
        if entry is None:
            return None
        size, refs = entry
        total += size
        stack.extend(refs)
    return total
