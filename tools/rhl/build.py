"""Turn one nix-eval-jobs run plus the multiverse index into the game's
data: data/game.json (the common pool) and data/deep.json (the deep-cuts
pool, loaded on demand).

    python3 -m tools.rhl.build --eval .work/eval.jsonl --multiverse DIR ...

Steps, each logged with how long it took:

1. read the evaluation: every attribute that evaluated, and the distinct
   derivations among them, which are the universe rebuilds are counted in
2. walk inputDrvs from those derivations through the store
3. count, for every top-level package, how many of the universe have it in
   their build closure
4. join version counts and first-seen windows from the multiverse
5. choose the two tiers (tools/rhl/pool.py)
6. walk cache.nixos.org narinfos for each chosen package's runtime closure
7. name a few of each chosen package's dependents, best known first, for
   the page to show under its rebuild count
"""

import argparse
import json
import os
import sys
import time

from . import closure, drvgraph, evaljobs, multiverse, pool

# The schema of both data files; site/js/data.js refuses any other.
SCHEMA = 3

# The size of the common pool, and of the common and deep-cuts pools
# together.
COMMON_SIZE = 1000
DEEP_SIZE = 10000

# Long descriptions are cut to fit a card.
DESCRIPTION_LIMIT = 140

# How many dependents each package names.
DEPENDENT_EXAMPLES = 3

# Reading .drv files is I/O and syscalls; threads overlap them.
READ_THREADS = 16


def log(msg):
    print(msg, file=sys.stderr, flush=True)


class Timer:
    """Logs how long a step took, and keeps every step's time for
    <work>/timings.json."""

    def __init__(self):
        self.steps = {}

    def __call__(self, name):
        timer = self

        class Step:
            def __enter__(self):
                self.start = time.monotonic()
                log(f"{name}...")

            def __exit__(self, *exc):
                seconds = round(time.monotonic() - self.start, 1)
                timer.steps[name] = seconds
                log(f"{name}: {seconds}s")

        return Step()


def short(text):
    if text is None or len(text) <= DESCRIPTION_LIMIT:
        return text
    return text[: DESCRIPTION_LIMIT - 1].rstrip() + "…"


def dependent_order(records, names, preferred):
    """Every universe derivation, best-known first: the drvs in
    `preferred`, then the rest by the length of their shortest attribute,
    so a top-level package comes before a nested one. Returns the order
    and a name for each drv."""
    label = dict(names)
    for r in sorted(records, key=lambda r: (len(r["attr"]), r["attr"])):
        label.setdefault(r["drvPath"], r["attr"])

    rest = sorted(set(label) - set(preferred), key=lambda d: (len(label[d]), label[d]))
    return list(preferred) + rest, label


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--eval", required=True, help="nix-eval-jobs output")
    ap.add_argument("--multiverse", required=True, help="nixpkgs-multiverse checkout")
    ap.add_argument("--multiverse-rev", required=True)
    ap.add_argument("--nixpkgs-rev", required=True)
    ap.add_argument("--nixpkgs-date", required=True)
    ap.add_argument("--allow", required=True)
    ap.add_argument("--deny", required=True)
    ap.add_argument("--work", required=True, help="directory for intermediate files")
    ap.add_argument("--out", required=True, help="the common pool's file")
    ap.add_argument("--deep-out", required=True, help="the deep tier's file")
    args = ap.parse_args(argv)

    step = Timer()

    # 1. The evaluation.
    with step("read the evaluation"):
        with open(args.eval) as f:
            records, errors = evaljobs.read_eval(f)
    log(f"{len(records)} attributes evaluated, {errors} did not")
    universe = list(dict.fromkeys(r["drvPath"] for r in records))

    # 2. The graph.
    with step("walk the .drv graph"):
        graph = drvgraph.load_graph(universe, threads=READ_THREADS)
    edges = sum(len(v) for v in graph.values())
    sizes = {"universe": len(universe), "drvs": len(graph), "edges": edges}
    log(f"graph: {sizes}")

    # 3. Rebuild counts for every top-level package, named canonically,
    # where an allowed name beats the other spellings of its derivation.
    with open(args.allow) as f:
        allow_text = f.read()
    allow = pool.read_list(allow_text)
    with open(args.deny) as f:
        deny = set(pool.read_list(f.read()))
    names = pool.canonical_attrs(records, prefer=set(allow))
    with step("count reverse closures"):
        counts = drvgraph.reverse_closure_counts(graph, universe, list(names))

    # 4. The multiverse's version history, for every candidate, since the
    # deep tier ranks its tail by version count.
    with open(os.path.join(args.multiverse, "index", "history.json")) as f:
        history = json.load(f)
    with open(os.path.join(args.multiverse, "revisions.json")) as f:
        revisions = json.load(f)
    dates = [r["date"] for r in revisions]
    covered = history["revisionCount"]

    by_drv = {r["drvPath"]: r for r in records if names.get(r["drvPath"]) == r["attr"]}
    candidates = []
    for drv, attr in names.items():
        mv = multiverse.stats_for(attr, history["attrs"], dates) or {}
        candidates.append(
            dict(
                by_drv[drv],
                rebuilds=counts[drv],
                versions=mv.get("versions"),
                firstSeen=mv.get("firstSeen"),
            )
        )

    # 5. The tiers.
    common = pool.select_pool(candidates, set(allow), deny, COMMON_SIZE)
    common_attrs = {c["attr"] for c in common}
    deep = pool.select_deep(candidates, deny, DEEP_SIZE - len(common), common_attrs)
    present = {c["attr"] for c in candidates}
    missing = [a for a in allow if a not in present]
    if missing:
        log(f"allowed but not evaluated: {' '.join(missing)}")
    log(f"tiers: {len(common)} common, {len(deep)} more in deep cuts")

    # 6. Runtime closure sizes from cache.nixos.org. A narinfo never
    # changes, so the ones fetched by earlier runs are kept in the work
    # directory, written only after a walk completes, and only paths new
    # to this run are fetched.
    narinfos_file = os.path.join(args.work, "narinfos.json")
    info = {}
    if os.path.exists(narinfos_file):
        with open(narinfos_file) as f:
            info = json.load(f)
    chosen = common + deep
    with step("walk narinfos"):
        size_of = closure.closure_sizes([c["out"] for c in chosen], info=info)
    with open(narinfos_file, "w") as f:
        json.dump(info, f)
    log(f"{len(info)} narinfos known")

    # 7. Dependents to name. Preferred are the allow list, one section at
    # a time so the names are not all browsers, then the common pool, then
    # the deep-cuts pool, each in rank order.
    drv_of = {c["attr"]: c["drvPath"] for c in candidates}
    ranked = [a for a in pool.interleave_sections(allow_text) if a in common_attrs]
    ranked += [c["attr"] for c in chosen]
    preferred = [drv_of[a] for a in dict.fromkeys(ranked)]
    order, label = dependent_order(records, names, preferred)
    with step("name dependents"):
        _, firsts = drvgraph.reverse_closures(
            graph, order, [c["drvPath"] for c in chosen], examples=DEPENDENT_EXAMPLES
        )

    def package(c):
        return {
            "attr": c["attr"],
            "version": c["version"],
            "description": short(c["description"]),
            "out": c["out"],
            "rebuilds": c["rebuilds"],
            "dependents": [label[d] for d in firsts[c["drvPath"]]],
            "closureSize": size_of[c["out"]],
            "versions": c["versions"],
            "firstSeen": c["firstSeen"],
        }

    head = {
        "schema": SCHEMA,
        "system": "x86_64-linux",
        "nixpkgs": {"rev": args.nixpkgs_rev, "date": args.nixpkgs_date},
        "multiverse": {
            "rev": args.multiverse_rev,
            "revisions": covered,
            "first": dates[0],
            "last": dates[covered - 1],
        },
        "graph": dict(sizes, evalErrors=errors),
        "tiers": {"common": len(common), "deep": len(chosen)},
    }
    with open(args.out, "w") as f:
        f.write(dumps(head, [package(c) for c in common]))
    deep_head = {"schema": SCHEMA, "nixpkgs": head["nixpkgs"]}
    with open(args.deep_out, "w") as f:
        f.write(dumps(deep_head, [package(c) for c in deep]))
    with open(os.path.join(args.work, "timings.json"), "w") as f:
        json.dump(step.steps, f, indent=1)
    log(f"wrote {args.out} and {args.deep_out}")


def dumps(head, packages):
    """JSON with one package per line, so a data refresh diffs as the
    packages whose numbers moved."""
    lines = [json.dumps(p, ensure_ascii=False, separators=(",", ":")) for p in packages]
    body = json.dumps(head, indent=1, ensure_ascii=False)[:-2]
    return body + ',\n "packages": [\n  ' + ",\n  ".join(lines) + "\n ]\n}\n"


if __name__ == "__main__":
    main()
