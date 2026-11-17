// How the browser suite runs: Playwright's Chromium against a built
// `nix build .#site` tree served on a local port, so the hashed module
// directory and data files are what is under test, not site/.

import { defineConfig } from "@playwright/test";

// Named by whatever runs the suite: the flake check, or a developer with
// a build of their own. No default, so a run never tests an unknown tree.
const SITE_ROOT = process.env.SITE_ROOT;
if (!SITE_ROOT) {
  throw new Error("SITE_ROOT is unset; point it at the result of `nix build .#site`");
}

// Overridable so two runs on one machine do not collide on the port.
const DEFAULT_PORT = 8140;
const PORT = Number(process.env.SITE_PORT ?? DEFAULT_PORT);
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Everything is local, so a test that takes this long is stuck.
const TEST_TIMEOUT_MS = 30_000;

const VIEWPORT = { width: 1400, height: 900 };

export default defineConfig({
  testDir: ".",
  timeout: TEST_TIMEOUT_MS,
  // A retry would only hide an intermittent failure behind a pass.
  retries: 0,
  reporter: "list",
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1 --directory ${SITE_ROOT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "ignore",
  },
  use: {
    baseURL: BASE_URL,
    viewport: VIEWPORT,
    // The full Chromium in its new headless mode, the one browser the
    // flake check provides, rather than the separate headless shell.
    channel: "chromium",
    // Chromium's own sandbox needs privileges a Nix builder does not
    // have, and the run is already confined by Nix.
    launchOptions: { chromiumSandbox: false },
  },
});
