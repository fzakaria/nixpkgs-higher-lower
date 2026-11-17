# nixpkgs higher or lower

Higher or lower, played on nixpkgs. Two packages, one question: which
would rebuild more of nixpkgs if it changed?

Most rounds ask for the rebuild count: how many packages in nixpkgs have
the package's `.drv` somewhere in their build closure. `glibc` is in
89,093 of the 89,254 packages evaluated for x86_64-linux; `firefox` is in 3.
The other rounds ask which has the bigger runtime closure, which has
shipped more versions, and which was packaged first. The game runs until
the first wrong answer, on a common pool of 1,000 packages or on 9,000
deep cuts.

After each answer both cards show how to check the number: a
`nix why-depends --derivation` command from a package that depends on it,
the store path and `nix path-info -S` for closures, or the package's
history on nixmultiverse.com. Closure sizes can also be re-walked from the
page against cache.nixos.org.

Everything is precomputed into JSON shipped with the page. Nothing runs
on a server.

## Where the numbers come from

1. nixpkgs, pinned in `flake.lock`, is evaluated for x86_64-linux with
   nix-eval-jobs, which instantiates every package `nix-env -qa` lists.
2. Every `.drv` reachable from those packages is read from the store, and
   for each top-level package the pipeline counts the evaluated packages
   whose build closure contains it.
3. The common pool is the top-level packages ranked by that count, with
   build plumbing filtered out by name, plus a hand-kept list of
   applications nothing depends on (`data/pool-allow.txt`,
   `data/pool-deny.txt`). The deep-cuts pool is the next 9,000, the
   long tail ranked by how many versions nixpkgs has shipped.
4. Version counts and first-seen dates come from
   [nixpkgs-multiverse](https://nixmultiverse.com/)'s `index/history.json`,
   also pinned in `flake.lock`.
5. Runtime closure sizes are summed from cache.nixos.org's narinfos.
6. Each package gets a witness: the best-known package that has it in its
   build closure, for the `nix why-depends` command.

[docs/data.md](docs/data.md) has the details, what each step costs, and
why the result is committed rather than built in CI.

## Layout

`site/` is the static page: vanilla ES modules, no bundler, no
dependencies. `site/js/game.js` holds the rules (which pairs are fair,
who wins) and `site/js/verify.js` the proofs (commands, the live narinfo
walk), neither touching the DOM. `tools/rhl/` is
the data pipeline in Python, and `tools/eval-drvs.sh` the evaluation it
starts from. `data/game.json` and `data/deep.json` are the pipeline's
output. `nix/` holds the
flake's pieces: `site.nix` assembles the deployable tree, `pipeline.nix`
is `nix run .#update-data`, `serve.nix` is the local server,
`formatter.nix` is `nix fmt`, and `browser-tests.nix` runs
`tests/browser/` in Chromium. `tests/pipeline/` and `tests/site/` are the
unit tests.

## Running

```console
$ nix run .#serve         # build the site and serve it on :8139
$ nix build               # the deployable tree, in ./result
$ nix flake check         # unit and browser tests, and the site assembles
$ nix fmt                 # before committing
```

To iterate on the page without rebuilding, serve the checkout's `site/`
directly; the server answers the data files from `data/`:

```console
$ NHL_SITE=$PWD/site nix run .#serve
```

To regenerate the data, from the root of a checkout:

```console
$ nix run .#update-data                 # everything; the evaluation alone
                                        # took 6 to 34 minutes here
$ nix run .#update-data -- --reuse-eval # after editing the pool lists, ~2 min
```

`NHL_LIVE=1 node --test tests/site/live.test.mjs` (in `nix develop`)
walks three real closures through cache.nixos.org with the page's code.

The site is deployed to GitHub Pages by `.github/workflows/pages.yml`
from `nix build .#site`.

## Credits

- [nix-eval-jobs](https://github.com/nix-community/nix-eval-jobs) for the
  evaluation.
- [nixpkgs-multiverse](https://github.com/fzakaria/nixpkgs-multiverse)
  for every version nixpkgs ever shipped.
- [The Higher Lower Game](https://www.higherlowergame.com/) for the format.

## License

MIT, please see [LICENSE](LICENSE).
