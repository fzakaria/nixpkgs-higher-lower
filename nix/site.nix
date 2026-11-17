# `nix build .#site` — the whole deployable tree, so the pages workflow
# only has to upload what nix built:
#
#   index.html, style.css, js.<hash>/   the page and its modules
#   game.<hash>.json                    data/game.json, the common pool
#   deep.<hash>.json                    data/deep.json, the rest of deep cuts
#
# No dependencies to vendor: the page is plain ES modules.
{ pkgs }:
pkgs.runCommand "nixpkgs-higher-lower-site" { } ''
  mkdir -p $out
  # The site directory and the data files alone, so a change to a test, a
  # tool or a doc does not rebuild the site.
  cp -r ${../site}/. $out/
  chmod -R u+w $out
  rm -f $out/game.json $out/deep.json

  # The data files are fetched by name, so each one's content hash goes
  # into its name, and data.js is pointed at them before the module tree
  # is hashed.
  for name in game deep; do
    file=${../data}/$name.json
    sum=$(sha256sum $file | cut -c1-12)
    cp $file $out/$name.$sum.json
    substituteInPlace $out/js/data.js \
      --replace-fail "\"$name.json\"" "\"$name.$sum.json\""
  done

  # The footer names the store path serving the page.
  substituteInPlace $out/js/app.js --replace-fail "__STORE_PATH__" "$out"

  # Hash the module tree and rename it js.<hash>, so the served HTML and
  # every module it imports can never be a mismatched pair across deploys.
  hash=$(find $out/js -type f | LC_ALL=C sort |
    xargs sha256sum | sha256sum | cut -c1-12)
  mv $out/js "$out/js.$hash"
  substituteInPlace $out/index.html --replace-fail "js/app.js" "js.$hash/app.js"

  # The stylesheet keeps its name, so its content hash rides as a query
  # string instead.
  css=$(sha256sum $out/style.css | cut -c1-12)
  substituteInPlace $out/index.html --replace-fail '"style.css"' "\"style.css?v=$css\""
''
