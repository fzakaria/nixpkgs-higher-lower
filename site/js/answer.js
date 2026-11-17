// The revealed number on a card, which is also how to check it. Every
// kind of round writes its number the same way, dotted underline and
// clickable, and a muted note under it takes what the click finds:
//
//   versions, first seen   a link to the package on nixmultiverse.com
//   closure size           a live walk of cache.nixos.org, its result in
//                          the note
//   rebuilds               the note names a few dependents
//
// A number with nothing behind it (no dependents, no cached closure) is
// plain text.

import { formatCount, formatDependents, formatLiveResult, formatStat } from "./format.js";
import { multiverseUrl, walkClosure } from "./verify.js";

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

// The number as a button that runs `onClick` with the note element.
function button(text, note, onClick) {
  const node = el("button", { type: "button", class: "answer" }, text);
  node.addEventListener("click", () => onClick(node, note));
  return node;
}

// Walk the closure from the browser and put the result in the note.
async function checkLive(p, node, note) {
  node.disabled = true;
  note.className = "note muted";
  note.textContent = "walking cache.nixos.org…";
  try {
    const result = await walkClosure(p.out, undefined, {
      onProgress: ({ paths }) => {
        note.textContent = `walking cache.nixos.org: ${formatCount(paths)} paths so far`;
      },
    });
    note.className = result.bytes === p.closureSize ? "note right" : "note wrong";
    note.textContent = formatLiveResult(result, p.closureSize);
  } catch (e) {
    note.className = "note error";
    note.textContent = `could not check: ${e.message}`;
  } finally {
    node.disabled = false;
  }
}

// The number for one question on one package, written into `stat`, with
// `note` for what a click finds.
export function showAnswer(type, p, stat, note) {
  const text = formatStat(type, p);
  note.className = "note muted";
  note.textContent = "";

  // Versions and first-seen dates: the package's history.
  if (type === "versions" || type === "firstSeen") {
    stat.replaceChildren(el("a", { class: "answer", href: multiverseUrl(p.attr) }, text));
    return;
  }

  // Closure sizes: the live walk, when the cache had the closure.
  if (type === "closureSize") {
    if (p.closureSize === null) {
      stat.replaceChildren(text);
      return;
    }
    stat.replaceChildren(button(text, note, (node) => checkLive(p, node, note)));
    return;
  }

  // Rebuild counts: a few named dependents, shown and hidden by the click.
  const dependents = formatDependents(p.dependents, p.rebuilds);
  if (dependents === null) {
    stat.replaceChildren(text);
    return;
  }
  stat.replaceChildren(
    button(text, note, () => {
      note.textContent = note.textContent ? "" : dependents;
    }),
  );
}
