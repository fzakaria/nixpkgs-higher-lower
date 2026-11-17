// Tests the built page in Chromium: what each kind of revealed number
// links to or does when clicked, that navigating to a methods section
// leaves the game alone, that the pool choice survives a reload, and
// that a phone-width page never scrolls sideways. Rounds are random, so
// each test answers rounds until the one it needs comes up.

import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// How each kind of round's question reads on the page.
const QUESTION = {
  rebuilds: /rebuild/i,
  closureSize: /closure/i,
  versions: /versions/i,
  firstSeen: /packaged first/i,
};

// Rounds to answer while waiting for one kind of round before giving up.
const MAX_ROUNDS = 80;

const PHONE = { width: 390, height: 844 };

const STORE = "/nix/store/";
const NARINFO_ROUTE = "https://cache.nixos.org/*.narinfo";
const MULTIVERSE_PKG_URL = "https://nixmultiverse.com/?pkg=";
const NIXPKGS_COMMIT_URL = "https://github.com/NixOS/nixpkgs/commit/";
const HTTP_NOT_FOUND = 404;

// The common pool as the built site ships it, read from the tree under
// test: the closure tests answer narinfo requests from it.
function commonPackages() {
  const root = process.env.SITE_ROOT;
  const file = readdirSync(root).find((name) => /^game\.[0-9a-f]+\.json$/.test(name));
  return JSON.parse(readFileSync(join(root, file))).packages;
}

// Answers rounds until a round of `type` for which `wanted(page)` holds
// is revealed. The first card is always the pick; right or wrong, the
// next button starts another round.
async function revealRound(page, type, wanted = async () => true) {
  await expect(page.locator("#question")).not.toBeEmpty();
  for (let i = 0; i < MAX_ROUNDS; i++) {
    const question = await page.locator("#question").textContent();
    await page.locator(".card .pick").first().click();
    await expect(page.locator("#after")).toBeVisible();
    if (QUESTION[type].test(question) && (await wanted(page))) {
      return;
    }
    await page.locator("#next").click();
  }
  throw new Error(`no ${type} round in ${MAX_ROUNDS} rounds`);
}

// The cards' names and the status line, which change whenever the game
// moves to another round or restarts.
async function gameState(page) {
  return {
    attrs: await page.locator(".card .attr").allTextContents(),
    status: await page.locator("#status").textContent(),
  };
}

// Tests the bug where following a link to the methods switched the game
// mode: after navigating to the rebuild-count section the same answered
// round is on screen, and the section is open and in view.
test("a methods fragment keeps the round and shows the section", async ({ page }) => {
  await page.goto("/");
  await revealRound(page, "rebuilds");
  const before = await gameState(page);

  await page.evaluate(() => {
    location.hash = "#how-rebuilds";
  });

  // Let the hashchange handler run before looking at the game.
  await page.waitForFunction(() => location.hash === "#how-rebuilds");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));

  await expect(page.locator("#after")).toBeVisible();
  expect(await gameState(page)).toEqual(before);
  await expect(page.locator("#help")).toHaveAttribute("open", "");
  await expect(page.locator("#how-rebuilds")).toBeInViewport();
});

// Tests that the pool buttons are the only mode choice and that the
// choice is read back from localStorage after a reload.
test("the pool choice survives a reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Daily", { exact: true })).toHaveCount(0);
  const deep = page.getByRole("button", { name: /Deep cuts/ });
  await deep.click();
  await expect(deep).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(page.getByRole("button", { name: /Deep cuts/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: /Common/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

// Tests that a versions or age number links to its package on the
// multiverse, and that no proof panel or copy button is left.
for (const type of ["versions", "firstSeen"]) {
  test(`a ${type} number links to the multiverse`, async ({ page }) => {
    await page.goto("/");
    await revealRound(page, type);
    for (const card of await page.locator(".card").all()) {
      const attr = await card.locator(".attr").textContent();
      await expect(card.locator(".stat a")).toHaveAttribute(
        "href",
        MULTIVERSE_PKG_URL + encodeURIComponent(attr),
      );
    }
    await expect(page.locator("#proofs")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy" })).toHaveCount(0);
  });
}

// Tests the inline live check on a closure number: with cache.nixos.org
// answering each root with its recorded size and no references, the
// line beside the number reports a match.
test("a closure number checks itself against the cache", async ({ page }) => {
  const sizeByHash = new Map(
    commonPackages().map((p) => [p.out.slice(STORE.length).split("-", 1)[0], p.closureSize]),
  );
  await page.route(NARINFO_ROUTE, (route) => {
    const hash = new URL(route.request().url()).pathname.slice(1).split(".", 1)[0];
    route.fulfill({
      headers: { "access-control-allow-origin": "*" },
      contentType: "text/x-nix-narinfo",
      body: `StorePath: ${STORE}${hash}-x\nNarSize: ${sizeByHash.get(hash)}\nReferences: \n`,
    });
  });

  await page.goto("/");
  await revealRound(page, "closureSize");
  const card = page.locator(".card").first();
  await card.locator(".stat button").click();
  await expect(card.locator(".note")).toHaveText(/^cache\.nixos\.org: 1 path, .+, matches$/);
});

// Tests that a closure walk the cache cannot finish says so beside the
// number rather than reporting a smaller total.
test("a closure check reports a path the cache lacks", async ({ page }) => {
  await page.route(NARINFO_ROUTE, (route) =>
    route.fulfill({ status: HTTP_NOT_FOUND, headers: { "access-control-allow-origin": "*" } }),
  );
  await page.goto("/");
  await revealRound(page, "closureSize");
  const card = page.locator(".card").first();
  await card.locator(".stat button").click();
  await expect(card.locator(".note")).toContainText("is not in https://cache.nixos.org");
});

// Tests that a rebuild count with dependents opens a line naming some of
// them, and that a count of zero is plain text.
test("a rebuild number names some dependents", async ({ page }) => {
  await page.goto("/");
  await revealRound(page, "rebuilds");
  for (const card of await page.locator(".card").all()) {
    const stat = await card.locator(".stat").textContent();
    if (stat.startsWith("0 ")) {
      await expect(card.locator(".stat button")).toHaveCount(0);
      continue;
    }
    await card.locator(".stat button").click();
    await expect(card.locator(".note")).toHaveText(/^includes \S/);
  }
});

// Tests the footer: the nixpkgs commit link and the store path the page
// was built into.
test("the footer names the commit and the site's store path", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("nixpkgs higher or lower");
  const footer = page.locator("footer");
  await expect(footer.locator(`a[href^="${NIXPKGS_COMMIT_URL}"]`)).toHaveCount(1);
  await expect(footer).toContainText(/\/nix\/store\/[0-9a-z]{32}-nixpkgs-higher-lower-site/);
});

// Tests at phone width that no reveal makes the page wider than the
// screen, one round of each kind.
for (const type of Object.keys(QUESTION)) {
  test(`a ${type} reveal fits a phone`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/");
    await revealRound(page, type);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
}
