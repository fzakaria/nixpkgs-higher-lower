// The proof panel under each card once a round is answered: how to check
// the number the round asked about. Rebuild counts get a why-depends
// command, closure sizes the path-info command and a live walk of
// cache.nixos.org, and versions and first-seen dates a link to the
// package's history on the multiverse.

import { formatBytes, formatCount } from "./format.js";
import { multiverseUrl, pathInfoCommand, walkClosure, whyDependsCommand } from "./verify.js";

// The id of the rebuild-count section of "How the numbers were
// measured" in index.html, which the rebuild proof links to.
const REBUILDS_METHODS_ID = "how-rebuilds";

// A small element builder: text only, never HTML, since descriptions and
// names come from nixpkgs.
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") {
      node.className = v;
      continue;
    }
    node.setAttribute(k, v);
  }
  for (const child of children) {
    node.append(child);
  }
  return node;
}

// A command the player can run, in a box.
function command(text) {
  return el("pre", { class: "cmd" }, el("code", {}, text));
}

function rebuildsProof(p, data) {
  if (p.witness === null) {
    return [el("p", {}, "Nothing depends on it at build time.")];
  }
  const lead =
    p.rebuilds === 1 ? "The only package that depends on it: " : "One package that depends on it: ";
  return [
    el("p", {}, lead, el("code", {}, p.witness)),
    command(whyDependsCommand(data.nixpkgs.rev, p.witness, p.attr)),
    el(
      "p",
      { class: "muted" },
      `It prints the chain of .drv files from ${p.witness} down to ${p.attr}. `,
      el("a", { href: `#${REBUILDS_METHODS_ID}` }, "How the full count was made"),
      ".",
    ),
  ];
}

// The live check: walk the closure from the browser and compare.
function liveCheck(p) {
  const status = el("span", { class: "live muted" });
  const button = el("button", { type: "button", class: "check" }, "Check it live");
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.className = "live muted";
    status.textContent = "Walking narinfos…";
    try {
      const result = await walkClosure(p.out, undefined, {
        onProgress: ({ paths, bytes }) => {
          status.textContent = `${formatCount(paths)} paths, ${formatCount(bytes)} bytes so far`;
        },
      });
      const same = result.bytes === p.closureSize;
      status.className = same ? "live right" : "live wrong";
      status.textContent =
        `cache.nixos.org now: ${formatCount(result.paths)} paths, ` +
        `${formatCount(result.bytes)} bytes. ` +
        (same ? "Matches." : `The game recorded ${formatCount(p.closureSize)}.`);
    } catch (e) {
      status.className = "live error";
      status.textContent = `Could not walk the closure: ${e.message}`;
    } finally {
      button.disabled = false;
    }
  });
  return el("div", { class: "check-row" }, button, status);
}

function closureProof(p) {
  return [
    el("p", { class: "path" }, el("code", {}, p.out)),
    el("p", {}, `${formatBytes(p.closureSize)} is ${formatCount(p.closureSize)} bytes:`),
    command(pathInfoCommand(p.out)),
    liveCheck(p),
  ];
}

function historyProof(p) {
  return [el("p", {}, el("a", { href: multiverseUrl(p.attr) }, `${p.attr} on nixmultiverse.com`))];
}

// The rounds whose proof is a single link that already names the
// package, so the panel needs no heading.
const LINK_ONLY = new Set(["versions", "firstSeen"]);

// The whole panel for one package and one question.
export function proofPanel(type, p, data) {
  const body = {
    rebuilds: () => rebuildsProof(p, data),
    closureSize: () => closureProof(p),
    versions: () => historyProof(p),
    firstSeen: () => historyProof(p),
  }[type]();
  if (LINK_ONLY.has(type)) {
    return el("div", { class: "proof" }, ...body);
  }
  return el("div", { class: "proof" }, el("h3", {}, p.attr), ...body);
}
