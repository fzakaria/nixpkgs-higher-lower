// The revealed number on a card, which is also how to check it. A number
// with a page behind it is a link with a dotted underline, and a muted
// note under it says what the page found on its own:
//
//   versions, first seen   links to the package on nixmultiverse.com
//   closure size           links to the store path on seenix; the note
//                          is a live walk of cache.nixos.org, run on
//                          reveal
//   rebuilds               plain, since no site lists a derivation's
//                          reverse closure; the note names a few
//                          dependents
//
// A closure the cache does not have is plain text with no note.

import { formatCount, formatDependents, formatLiveResult, formatStat } from "./format.js";
import { multiverseUrl, seenixUrl, walkClosure } from "./verify.js";

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

// Each reveal's number, so a walk still running when the player moves
// on never writes into the next round's note.
let reveals = 0;

// Clear a card's number and note, and orphan any walk still writing.
export function clearAnswer(stat, note) {
  note.dataset.reveal = String(++reveals);
  stat.replaceChildren();
  note.className = "note muted";
  note.textContent = "";
}

// Walk the closure from the browser and put the result in the note, for
// as long as the note still belongs to this reveal.
async function checkLive(p, note) {
  const reveal = note.dataset.reveal;
  const write = (className, text) => {
    if (note.dataset.reveal !== reveal) {
      return;
    }
    note.className = className;
    note.textContent = text;
  };

  write("note muted", "walking cache.nixos.org…");
  try {
    const result = await walkClosure(p.out, undefined, {
      onProgress: ({ paths }) => {
        write("note muted", `walking cache.nixos.org: ${formatCount(paths)} paths so far`);
      },
    });
    const same = result.bytes === p.closureSize;
    write(same ? "note right" : "note wrong", formatLiveResult(result, p.closureSize));
  } catch (e) {
    write("note error", `could not check: ${e.message}`);
  }
}

// The number for one question on one package, written into `stat`, with
// `note` for what a click finds.
export function showAnswer(type, p, stat, note) {
  const text = formatStat(type, p);
  clearAnswer(stat, note);

  // Versions and first-seen dates: the package's history.
  if (type === "versions" || type === "firstSeen") {
    stat.replaceChildren(el("a", { class: "answer", href: multiverseUrl(p.attr) }, text));
    return;
  }

  // Closure sizes: the store path on seenix, and the live walk, when the
  // cache had the closure.
  if (type === "closureSize") {
    if (p.closureSize === null) {
      stat.replaceChildren(text);
      return;
    }
    stat.replaceChildren(el("a", { class: "answer", href: seenixUrl(p.out) }, text));
    checkLive(p, note);
    return;
  }

  // Rebuild counts: plain, with a few named dependents under them.
  stat.replaceChildren(text);
  note.textContent = formatDependents(p.dependents, p.rebuilds) ?? "";
}
