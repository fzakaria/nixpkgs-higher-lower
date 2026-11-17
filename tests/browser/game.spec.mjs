// Tests the built page in Chromium: what a reveal shows for each kind of
// round, that the methods link on a rebuild round leaves the game alone,
// that the pool choice survives a reload, and that a phone-width page
// never scrolls sideways. Rounds are random, so each test answers rounds
// until the one it needs comes up.

import { test, expect } from "@playwright/test";

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

const CACHE_URL = "https://cache.nixos.org";
const MULTIVERSE_PKG_URL = "https://nixmultiverse.com/?pkg=";

// Answers rounds until a round of `type` for which `wanted(page)` holds
// is revealed. The first card is always the pick; right or wrong, the
// next button starts another round.
async function revealRound(page, type, wanted = async () => true) {
  await expect(page.locator("#question")).not.toBeEmpty();
  for (let i = 0; i < MAX_ROUNDS; i++) {
    const question = await page.locator("#question").textContent();
    await page.locator(".card").first().click();
    await expect(page.locator("#proofs")).toBeVisible();
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

// Tests the bug where the methods link under a rebuild round's witness
// switched the game mode: after the click the same round is on screen,
// answered, and the rebuild-count methods are open and in view.
test("the methods link keeps the round and shows the rebuild methods", async ({ page }) => {
  await page.goto("/");
  const link = page.getByRole("link", { name: "How the full count was made" }).first();
  await revealRound(page, "rebuilds", async () => (await link.count()) > 0);
  const before = await gameState(page);

  await link.click();

  // Let the fragment navigation and any hashchange handler run before
  // looking at the game.
  await page.waitForFunction(() => location.hash !== "");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));

  await expect(page.locator("#proofs")).toBeVisible();
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

// Tests a closure round's reveal: the store path, the path-info command
// and the live check stay, the printed expected output is gone, and no
// copy buttons remain.
test("a closure reveal shows the command and the live check only", async ({ page }) => {
  await page.goto("/");
  await revealRound(page, "closureSize");
  const proofs = page.locator("#proofs");
  await expect(proofs).toContainText(`nix path-info -S --store ${CACHE_URL} /nix/store/`);
  await expect(page.getByRole("button", { name: "Check it live" })).toHaveCount(2);
  await expect(proofs.locator(".output")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy" })).toHaveCount(0);
});

// Tests a versions round's reveal: one multiverse link per package and
// no mvs command or output.
test("a versions reveal links each package on the multiverse", async ({ page }) => {
  await page.goto("/");
  await revealRound(page, "versions");
  const proofs = page.locator("#proofs");
  await expect(proofs.locator(`a[href^="${MULTIVERSE_PKG_URL}"]`)).toHaveCount(2);
  await expect(proofs).not.toContainText("mvs");
  await expect(page.getByRole("button", { name: "Copy" })).toHaveCount(0);
});

// Tests that the footer names the store path the page was built into.
test("the footer shows the site's store path", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("nixpkgs higher or lower");
  await expect(page.locator("footer")).toContainText(
    /\/nix\/store\/[0-9a-z]{32}-nixpkgs-higher-lower-site/,
  );
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
