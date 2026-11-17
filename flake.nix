{
  description = "Higher or lower, played on nixpkgs: which package would rebuild more of it?";

  # One nixpkgs, pinned to a revision rather than a branch, because it is
  # two things at once: the toolchain this flake builds with, and the tree
  # data/game.json was measured from. `nix run .#update-data` evaluates
  # exactly this input, so bumping it in flake.lock is how the game moves
  # to a newer nixpkgs.
  #
  # The multiverse is pinned the same way: its committed index/history.json
  # and revisions.json are where version counts and first-seen dates come
  # from. Nothing but update-data reads it, so other outputs never fetch it.
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/6dadaf4375be35033e1c84395adbd53ff5fded96";
    multiverse = {
      url = "github:fzakaria/nixpkgs-multiverse/0e0b03cad7c24221d3e59b886bc74d1af5f71d3c";
      flake = false;
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      multiverse,
    }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system);
      pkgsFor = system: nixpkgs.legacyPackages.${system};
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        rec {
          # the static site with its data: everything the pages workflow
          # deploys and `nix run .#serve` serves locally
          site = import ./nix/site.nix { inherit pkgs; };
          default = site;

          # the data pipeline's tools, on their own
          pipeline = import ./nix/pipeline.nix { inherit pkgs nixpkgs multiverse; };
        }
      );

      apps = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
          pipeline = self.packages.${system}.pipeline;
        in
        {
          # serve the built site, exactly the tree pages deploys.
          # `nix run .#serve -- <port>` overrides the default 8139.
          # $RHL_SITE serves a checkout's site/ directory instead, for
          # iterating without a rebuild (it needs data/game.json copied or
          # linked to site/game.json).
          serve = {
            type = "app";
            program = "${import ./nix/serve.nix {
              inherit pkgs;
              site = self.packages.${system}.site;
            }}";
          };

          # regenerate data/game.json from the pinned nixpkgs input. Heavy:
          # see docs/data.md for what it costs and why it runs here and
          # not in CI.
          update-data = {
            type = "app";
            program = "${pipeline}/bin/rhl-update-data";
          };
        }
      );

      checks = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
          site = self.packages.${system}.site;
        in
        {
          # the pipeline's unit tests: drv parsing, the reverse closure
          # count, pool filtering, and joining the multiverse history
          pipeline =
            pkgs.runCommand "rhl-pipeline-tests"
              { nativeBuildInputs = [ (import ./nix/python.nix { inherit pkgs; }) ]; }
              ''
                cp -r ${./tools} tools
                cp -r ${./tests} tests
                python3 -m unittest discover -s tests/pipeline -t . -v
                touch $out
              '';

          # the game's unit tests (seeding, the daily draw, pair choice,
          # scoring, the share line), and a pass over the committed data
          # that the game can draw every daily round from it
          site-tests = pkgs.runCommand "rhl-site-tests" { nativeBuildInputs = [ pkgs.nodejs ]; } ''
            cp -r ${./site} site
            cp -r ${./tests} tests
            cp -r ${./data} data
            cp ${./package.json} package.json
            node --test tests/site/*.test.mjs
            touch $out
          '';

          # the site assembles: the entry page, the hashed module tree and
          # the data are where the build put them
          site = pkgs.runCommand "rhl-site-check" { } ''
            test -f ${site}/index.html
            test -f ${site}/js.*/app.js
            test -f ${site}/game.*.json
            test -f ${site}/deep.*.json
            grep -q 'game\.[0-9a-f]*\.json' ${site}/js.*/data.js
            grep -q 'deep\.[0-9a-f]*\.json' ${site}/js.*/data.js
            touch $out
          '';
        }
      );

      formatter = forAllSystems (system: import ./nix/formatter.nix { pkgs = pkgsFor system; });

      devShells = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs
              pkgs.jq
              (import ./nix/python.nix { inherit pkgs; })
            ];
          };
        }
      );
    };
}
