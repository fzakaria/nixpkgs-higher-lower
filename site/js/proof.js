// The proof panel under each card once a round is answered: the package's
// store path, and the command that reproduces the number the round asked
// about, with what it prints. Closure sizes can also be checked live,
// from the browser, against cache.nixos.org.

import { formatBytes, formatCount } from "./format.js";
import {
  mvsCommand,
  mvsHeader,
  multiverseUrl,
  pathInfoCommand,
  pathInfoOutput,
  walkClosure,
  whyDependsCommand,
} from "./verify.js";

// How long a copy button says it copied.
const COPIED_MS = 1500;

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

export async function copyText(button, text, fallback) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard access is refused on plain http and in some frames;
    // selecting the text leaves the copy to the player.
    fallback?.();
    return;
  }
  const label = button.textContent;
  button.textContent = "Copied";
  setTimeout(() => (button.textContent = label), COPIED_MS);
}

// A command in a box with a copy button.
function command(text) {
  const code = el("code", {}, text);
  const copy = el("button", { type: "button", class: "copy" }, "Copy");
  copy.addEventListener("click", () =>
    copyText(copy, text, () => getSelection().selectAllChildren(code)),
  );
  return el("div", { class: "cmd" }, el("pre", {}, code), copy);
}

function output(text) {
  return el("pre", { class: "output" }, text);
}

function rebuildsProof(p, data) {
  if (p.witness === null) {
    return [el("p", {}, "Nothing in nixpkgs has it in its build closure.")];
  }
  const lead =
    p.rebuilds === 1
      ? "1 package depends on it at build time: "
      : `${formatCount(p.rebuilds)} packages depend on it at build time. One of them is `;
  return [
    el("p", {}, lead, el("code", {}, p.witness), "."),
    command(whyDependsCommand(data.nixpkgs.rev, p.witness, p.attr)),
    el(
      "p",
      { class: "muted" },
      `It prints the chain of .drv files from ${p.witness} down to ${p.attr}. `,
      el("a", { href: "#help" }, "How the full count was made"),
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
    el("p", {}, `${formatBytes(p.closureSize)} is ${formatCount(p.closureSize)} bytes:`),
    command(pathInfoCommand(p.out)),
    output(pathInfoOutput(p.out, p.closureSize)),
    liveCheck(p),
  ];
}

function historyProof(p, data) {
  return [
    el(
      "p",
      {},
      "Every version: ",
      el("a", { href: multiverseUrl(p.attr) }, `nixmultiverse.com/?pkg=${p.attr}`),
      ", or:",
    ),
    command(mvsCommand(data.multiverse.rev, p.attr)),
    el("p", { class: "muted" }, "Its first line starts:"),
    output(mvsHeader(p.attr, p.versions, p.firstSeen.by)),
  ];
}

// The whole panel for one package and one question.
export function proofPanel(type, p, data) {
  const body = {
    rebuilds: () => rebuildsProof(p, data),
    closureSize: () => closureProof(p),
    versions: () => historyProof(p, data),
    firstSeen: () => historyProof(p, data),
  }[type]();
  return el(
    "div",
    { class: "proof" },
    el("h3", {}, p.attr),
    el("p", { class: "path" }, el("code", {}, p.out)),
    ...body,
  );
}
