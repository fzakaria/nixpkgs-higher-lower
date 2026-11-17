# The browser suite: tests/browser/*.spec.mjs, run by Playwright's
# Chromium against the built site on a loopback port inside the build
# sandbox. Nothing it loads leaves the machine; the only network the page
# uses is the "Check it live" walk, which the suite never clicks.
{ pkgs, site }:
pkgs.runCommand "nixpkgs-higher-lower-browser-tests"
  {
    nativeBuildInputs = [
      pkgs.playwright-test
      pkgs.python3
    ];
    SITE_ROOT = site;

    # Playwright would download its own browsers; point it at the nixpkgs
    # Chromium instead, and skip its audit for distro packages.
    PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.browsers-chromium;
    PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
  }
  ''
    # Chromium wants a writable home for its profile, and Playwright
    # writes results beside its config, so run from a copy.
    export HOME=$(mktemp -d)
    cp -r ${../tests/browser}/. .

    # The specs are native ES modules, which node resolves from a
    # node_modules beside them, not from the playwright command's own.
    ln -s ${pkgs.playwright-test}/lib/node_modules node_modules
    playwright test
    touch $out
  ''
