# `nix fmt`. The tree wrapper, matching seenix and nixpkgs-multiverse: one
# formatting step covers every language in the tree. prettier for the
# site's JS and CSS and for markdown at the width the docs are written to,
# black for the pipeline in tools/. index.html is left alone, as in
# seenix: prettier's whitespace-insensitive HTML mode puts a space before
# punctuation that follows inline markup.
{ pkgs }:
pkgs.nixfmt-tree.override {
  runtimeInputs = [
    pkgs.prettier
    pkgs.black
  ];
  settings = {
    # Generated data is not ours to format; tools/rhl/build.py writes it
    # one package per line on purpose.
    global.excludes = [
      "data/game.json"
      "data/deep.json"
    ];
    formatter.prettier = {
      command = "prettier";
      options = [
        "--write"
        "--print-width"
        "100"
      ];
      includes = [
        "*.js"
        "*.mjs"
        "*.css"
      ];
    };
    # proseWrap stays at its default of preserving the author's line
    # breaks: these files are hand-wrapped prose.
    formatter.prettier-markdown = {
      command = "prettier";
      options = [
        "--write"
        "--print-width"
        "80"
      ];
      includes = [ "*.md" ];
    };
    formatter.black = {
      command = "black";
      options = [
        "--quiet"
        "--line-length"
        "100"
      ];
      includes = [ "*.py" ];
    };
  };
}
