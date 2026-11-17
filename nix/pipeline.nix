# `nix run .#update-data` — regenerate data/game.json and data/deep.json
# from the pinned nixpkgs and multiverse inputs. Run it from the root of a
# checkout: it writes the data there and keeps its intermediate files in
# .work/.
#
#   --reuse-eval   keep .work/eval.jsonl from the last run, which is the
#                  slow, ten-gigabyte step; for editing data/pool-allow.txt
#                  and data/pool-deny.txt (the .drv files it rooted in
#                  .work/gcroots must still be in the store)
#
# The tools come from this flake rather than the checkout, so the data
# always matches a committed pipeline.
{
  pkgs,
  nixpkgs,
  multiverse,
}:
let
  python = import ./python.nix { inherit pkgs; };
  tools = pkgs.runCommand "nixpkgs-higher-lower-tools" { } ''
    mkdir -p $out
    cp -r ${../tools} $out/tools
  '';
  date = d: "${builtins.substring 0 4 d}-${builtins.substring 4 2 d}-${builtins.substring 6 2 d}";
in
pkgs.writeShellApplication {
  name = "nixpkgs-higher-lower-update-data";
  runtimeInputs = [
    pkgs.nix-eval-jobs
    python
    pkgs.coreutils
  ];
  text = ''
    if [ ! -f data/pool-allow.txt ]; then
      echo "run this from the root of a nixpkgs-higher-lower checkout" >&2
      exit 2
    fi

    reuse_eval=
    for arg in "$@"; do
      case "$arg" in
        --reuse-eval) reuse_eval=1 ;;
        *) echo "unknown flag $arg" >&2; exit 2 ;;
      esac
    done

    mkdir -p .work
    if [ -z "$reuse_eval" ] || [ ! -f .work/eval.jsonl ]; then
      start=$(date +%s)
      ${tools}/tools/eval-drvs.sh ${nixpkgs} .work/eval.jsonl .work/gcroots 2> .work/eval.err
      echo "evaluation: $(( $(date +%s) - start ))s" >&2
    fi

    PYTHONPATH=${tools} python3 -m tools.rhl.build \
      --eval .work/eval.jsonl \
      --multiverse ${multiverse} \
      --multiverse-rev ${multiverse.rev} \
      --nixpkgs-rev ${nixpkgs.rev} \
      --nixpkgs-date ${date nixpkgs.lastModifiedDate} \
      --allow data/pool-allow.txt \
      --deny data/pool-deny.txt \
      --work .work \
      --out data/game.json \
      --deep-out data/deep.json
  '';
}
