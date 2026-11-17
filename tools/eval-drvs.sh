#!/usr/bin/env bash
# Evaluate every package nixpkgs lists for x86_64-linux and write one JSON
# line per attribute: its drvPath, outputs, and the few meta fields the game
# shows. The same set `nix-env -qa` walks: top-level attributes plus the
# package sets marked recurseForDerivations.
#
# The derivations are instantiated, so every .drv in the graph lands in the
# store, where build-data reads their inputDrvs. --gc-roots-dir keeps them
# there until the pipeline is done.
#
# usage: eval-drvs.sh <nixpkgs source> <out.jsonl> <gc roots dir>
set -euo pipefail

if [ $# -ne 3 ]; then
  echo "usage: $0 <nixpkgs source> <out.jsonl> <gc roots dir>" >&2
  exit 2
fi
nixpkgs=$1
out=$2
roots=$3

# Memory is the budget, not cores: a worker that grows past the cap is
# recycled, so the peak is about workers x cap. 4 x 3 GiB stays under the
# ~14 GB that one `nix-env -qa` of the same tree needs.
workers=${EVAL_WORKERS:-4}
maxmem=${EVAL_MAXMEM:-3072}

mkdir -p "$roots"

# allowUnfree matches what the reference `nix-env -qaP --out-path` dump
# saw (docs/data.md); NIXPKGS_CONFIG is cleared so no user config leaks in.
expr="import $nixpkgs { system = \"x86_64-linux\"; config = { allowUnfree = true; }; overlays = []; }"

# Only what the game shows from meta, rather than --meta's whole set
# (maintainers and licenses would make the output ten times larger).
apply='drv: {
  pname = drv.pname or null;
  version = drv.version or null;
  description = drv.meta.description or null;
  homepage = let h = drv.meta.homepage or null; in if builtins.isList h then builtins.head h else h;
  outputName = drv.outputName or "out";
}'

NIXPKGS_CONFIG= nix-eval-jobs \
  --expr "$expr" \
  --apply "$apply" \
  --workers "$workers" \
  --max-memory-size "$maxmem" \
  --gc-roots-dir "$roots" \
  >"$out"
