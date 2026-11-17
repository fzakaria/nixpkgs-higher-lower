# The data

Everything the page knows is in two files written by
`nix run .#update-data` from two pinned inputs, nixpkgs and
nixpkgs-multiverse, both in `flake.lock`:

- `data/game.json`: the common pool of 1,000 packages, and the
  provenance the page reads (both revisions, the graph's size, the tier
  sizes). 323 KB, 86 KB gzipped.
- `data/deep.json`: the 9,000 packages of the deep-cuts pool, fetched
  only when a player picks it. 2.8 MB, 805 KB gzipped.

Each package carries its store path, its four stats, and up to three
named dependents, so every number the page reveals can be checked from
the page.

## Rebuild counts

A package's rebuild count is the number of packages in nixpkgs that have
its `.drv` somewhere in their build closure. Change the package, and every
one of them gets a new hash and is built again.

"Packages in nixpkgs" is what `nix-env -qa` lists for x86_64-linux: the
top-level attributes plus the package sets marked `recurseForDerivations`
(`python3Packages`, `haskellPackages`, and so on), with `allowUnfree` on.
`tools/eval-drvs.sh` gets it from nix-eval-jobs rather than `nix-env`,
because nix-eval-jobs bounds memory by recycling workers and leaves every
`.drv` in the store, rooted, for the next step to read. At `6dadaf43` it
evaluated 99,481 attributes, which cover 90,647 of the 90,650 attributes a
`nix-env -qaP --out-path` dump of the same revision lists (the three
missing have `+` in their names). Aliases make many attributes one
derivation, so the counts are over distinct derivations: 89,254 of them.

`tools/rhl/drvgraph.py` then reads `inputDrvs` out of every `.drv`
reachable from those 89,254, which is 272,243 derivations and 2,182,567
edges. Most of them are not packages anyone evaluates directly: fetches,
bootstrap stages, setup hooks. Each counts only as a path between packages.

The count itself is a bitset per derivation over a chunk of 4,096 target
packages. Walking the graph dependencies-first, each derivation's bits are
its own bit OR its inputs' bits, so a package's row ends up holding
exactly the targets in its closure, and the counts are column sums
(numpy, 8,192 rows at a time). Every top-level package is a target, so the
ranking below covers all 23,895 of them.

Checks made against the result: an independent reverse breadth-first
search from six packages (`python3`, `hello`, `firefox`, `openssl`,
`cmake`, `vim`) gave the same six counts, and the three packages counted
as depending on `firefox` each have firefox's `.drv` in `nix-store -qR` of
their own.

The whole count can be redone by hand, slowly, with one `nix-store -qR`
per evaluated package. This recipe has not been run end to end:

```sh
rev=6dadaf4375be35033e1c84395adbd53ff5fded96
src=$(nix flake prefetch --json "github:NixOS/nixpkgs/$rev" | jq -r .storePath)
nix-eval-jobs --workers 4 --max-memory-size 3072 --expr \
  "import $src { system = \"x86_64-linux\"; config.allowUnfree = true; }" > eval.jsonl
jq -r '.drvPath // empty' eval.jsonl | sort -u > drvs.txt
target=$(nix eval --raw "github:NixOS/nixpkgs/$rev#libndp.drvPath")
while read -r drv; do
  [ "$drv" != "$target" ] && nix-store -qR "$drv" | grep -qxF "$target" && echo "$drv"
done < drvs.txt | wc -l
```

The count belongs to the attribute. `gcc` is the wrapped compiler stdenv
uses, so almost everything counts it. stdenv's shell is
`bashNonInteractive` (89,061), so `bash`, the interactive build, counts
only the 55,075 packages that ask for it by name.

### Named dependents

Clicking a revealed rebuild count names a few of the packages it counts:
"includes firefox, libreoffice, steam and 9,647 others". Each package
carries the first three dependents in a preference order: the allow list
one section at a time (a browser, then an editor, then a terminal, and
so on round the sections, so the names are not all browsers), then the
common pool and the deep-cuts pool in rank order, then everything else
evaluated. The same bitset pass that counts finds the first three set
rows per column, which took 2.8 s for the 10,000 packages. The names add
25 KB to `game.json` and 98 KB to `deep.json`, before compression.

## The pools

`tools/rhl/pool.py` names each derivation by one of its top-level
attributes (an allow-listed name first, then the one equal to the
package's `pname`, then lowercase, then shortest), and drops nested
attributes and names that look like plumbing (`-unwrapped`, `stdenv`,
`Hook`, `Minimal`, `-dev`, version-suffixed copies of a package that is
also present, and so on).

The common pool is the 1,000 highest rebuild counts. Ranked that way it is
libraries and build tools, and nothing depends on a web browser, so
`data/pool-allow.txt` lists the applications people know and they are
always in; 191 of the 1,000 come from it. `data/pool-deny.txt` removes
what the name rules miss, with a reason for each group. The pipeline logs
allow-listed names that did not evaluate.

The deep-cuts pool is the next 9,000 by the same rules, without the
common pool. Only 5,057 of
the 22,834 candidates that pass the filters have any dependents, so past
that point rebuild count says nothing, and the tail is ranked by how many
versions nixpkgs has shipped: a package updated 38 times outranks a
one-off. The pool ends at packages with 9 versions.

## Versions and first-seen dates

Both come from the multiverse's `index/history.json`, which records every
version each attribute had at each of 1,581 nixos-unstable channel bumps
from July 2012 to November 2026. A version that came and went between two
bumps is missed, and an attribute renamed since starts its history at the
rename.

First seen is a window, not a day. An attribute first present at bump
_k_ arrived after bump _k-1_ and by bump _k_. The index has nothing
between 2013-10-31 and 2016-09-24, so anything added then has a
three-year window, and anything present at the first bump has no lower
bound. The game only asks which came first when the two windows do not
overlap and are at least 180 days apart.

The page links each package to `https://nixmultiverse.com/?pkg=<attr>`.
For `yq` and `softhsm`, `mvs query versions` at the pinned multiverse
revision printed `yq · 23 versions · 2017-11-30 ..` and
`softhsm · 7 versions · 2016-09-24 ..`, matching the data.

## Closure sizes

`tools/rhl/closure.py` walks cache.nixos.org's narinfos from each
package's default output (its `outputName`, which is `bin` for `ffmpeg`
and `curl`; `ffmpeg`'s `out` is a 96-byte NAR) and sums `NarSize` over the
closure, the number `nix path-info -S` prints. It does the walk itself
because `nix path-info` stops at the first path the cache lacks, and some
packages are unfree or were not built. Those get `null` and never come up
in a closure round. Five sizes (`hello`, `git`, `python3`, `firefox`,
`glibc`) were checked against `nix path-info -S --store
https://cache.nixos.org` and matched to the byte.

Clicking a revealed closure size repeats the walk in the browser
(`site/js/verify.js`): cache.nixos.org sends
`access-control-allow-origin: *`, so the page fetches the root narinfo,
follows `References` breadth-first with eight requests in flight, and
compares the sum. `tests/site/live.test.mjs` runs the same code against
the real cache when `NHL_LIVE=1`:

| package   | paths | bytes         | recorded      |
| --------- | ----- | ------------- | ------------- |
| `libndp`  | 5     | 38,322,544    | 38,322,544    |
| `python3` | 23    | 222,809,936   | 222,809,936   |
| `firefox` | 304   | 1,584,014,912 | 1,584,014,912 |

## Fair pairs

`site/js/game.js` decides which pairs are worth asking. Counts and sizes
must differ by a ratio of at least 1.2 (count + 1, so zero works) and at
most 25 for rebuilds or 10 for sizes. Versions must differ by at least two
and by a ratio of at most 5. First-seen windows must be between 180 days
and ten years apart. Each round's question is drawn four times in ten
for rebuilds and twice in ten for each of the others, and the last 40
packages shown are kept out of the next draws.
`tests/site/data.test.mjs` draws hundreds of pairs from each pool of the
committed files, with those packages excluded, and checks every draw
finds a pair.

## What it costs

Measured on a 16-core machine with 60 GB of RAM while another agent ran
its own Nix jobs:

| step                                   | time              |
| -------------------------------------- | ----------------- |
| evaluation (4 workers, 3 GiB cap each) | 373 s and 2,038 s |
| reading 272,243 `.drv` files           | 11 s              |
| counting rebuilds, 23,895 targets      | 24 s              |
| walking 25,063 narinfos, cold          | 45 s              |
| naming dependents, 10,000 targets      | 3 s               |

The two evaluation times are two runs of the same command; the second
ran while the machine was shared, and the cause of the gap was not
established. `nix run .#update-data -- --reuse-eval`, everything but the
evaluation, took 107 s. The evaluation's systemd scope peaked at 10.5 GB
and 13.2 GB of `memory.peak` in the two runs, which counts page cache as
well as the workers.

## Why the data is committed

The data files are checked in, and CI only tests them. The page is built
from them with no network access.

The evaluation is the reason. It peaks above 10 GB and takes minutes, and
nixpkgs-multiverse, whose `update-index.yml` does run evaluations on
GitHub's runners, caps them at four workers of 2.5 GB to fit a runner's
16 GB. That would work here too, but there is nothing to gain from it: the
output is a function of two pinned inputs and moves only when `flake.lock`
does, which is a commit someone makes on purpose. Regenerating on every
push would spend the evaluation to produce the same files.

The closure sizes are the one input that is not pinned: they are read from
cache.nixos.org on the day the pipeline runs. Committing the files keeps
what players see fixed until the next deliberate refresh, and each file
is one package per line, so a refresh reviews as a diff of the packages
whose numbers moved. Two runs from the same evaluation wrote
byte-identical files.

To move to a newer nixpkgs:

```console
$ nix flake update nixpkgs multiverse
$ nix run .#update-data
$ nix flake check
```

If it ever should run in CI, the multiverse's settings are the starting
point: `EVAL_WORKERS=4 EVAL_MAXMEM=2500 nix run .#update-data`, followed by
a commit of `data/`.
