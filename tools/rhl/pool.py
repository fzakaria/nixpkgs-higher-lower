"""Which packages the game asks about.

The pool is nixpkgs' top-level packages ranked by rebuild count, with build
plumbing filtered out by name, plus a hand-kept allow list of applications
people know that nothing depends on, and a deny list for what the name rules
miss (data/pool-allow.txt, data/pool-deny.txt).
"""

import re

# Name fragments that mark build plumbing rather than a package anyone
# would name: compiler wrappers' raw halves, stdenv itself, setup hooks,
# bootstrap stages.
PLUMBING = re.compile(
    r"unwrapped|Unwrapped|stdenv|Stdenv|bootstrap|Bootstrap|[Hh]ook|wrapper|Wrapper"
)

# Suffixes that mark a cut-down, enlarged or split variant of another
# package: `systemdMinimal`, `harfbuzzFull`, `ffmpeg-headless`,
# `systemdLibs`, `zeroad-data`, and the prebuilt `-bin` repackagings of
# things also built from source.
VARIANT_SUFFIXES = (
    "Minimal",
    "Full",
    "-headless",
    "_headless",
    "-light",
    "-slim",
    "Compat",
    "_compat",
    "-minimal",
    "Small",
    "-small",
    "Libs",
    "-libs",
    "-lib",
    "-dev",
    "-doc",
    "-man",
    "-data",
    "-bin",
    "NoX",
    "-nox",
)

# A name that ends in a version: `nodejs_22`, `python314`, `gcc14`,
# `lua5_4`. Group 1 is the name before it, group 2 the version digits.
VERSIONED = re.compile(r"^(.*?[A-Za-z+-])_?([0-9][0-9_]*)$")


def read_list(text):
    """The names in an allow or deny list, in file order: one per line,
    `#` comments. The allow list's order is also the order witnesses are
    preferred in, so the browsers at its top are the dependents shown
    first."""
    names = {}
    for raw in text.splitlines():
        name = raw.split("#", 1)[0].strip()
        if not name:
            continue
        names[name] = None
    return list(names)


def canonical_attrs(entries, prefer=frozenset()):
    """{drvPath: attr} naming each derivation by one of its top-level
    attributes. In order: a name in `prefer` (the allow list), the name
    equal to the package's pname (`openjdk` over `jdk`), an all-lowercase
    name (`supertuxkart` over `superTuxKart`), the shortest, the
    alphabetically first. A derivation reachable only inside a package set
    (`python3Packages.foo`) gets no name."""

    def rank(entry):
        attr = entry["attr"]
        return (
            attr not in prefer,
            attr != entry.get("pname"),
            attr != attr.lower(),
            len(attr),
            attr,
        )

    best = {}
    for entry in entries:
        if "." in entry["attr"]:
            continue

        drv = entry["drvPath"]
        if drv not in best or rank(entry) < rank(best[drv]):
            best[drv] = entry
    return {drv: entry["attr"] for drv, entry in best.items()}


def is_version_variant(attr, names):
    """Whether `attr` is a version-suffixed spelling of a package that is
    also present under a shorter one: `python314` next to `python3`,
    `nodejs_22` next to `nodejs`."""
    m = VERSIONED.match(attr)
    if not m:
        return False

    base, digits = m.group(1), m.group(2)
    for k in range(len(digits)):
        shorter = (base + digits[:k]).rstrip("_-")
        if shorter != attr and shorter in names:
            return True
    return False


def is_noise(attr, names):
    """Whether `attr` names plumbing, a split, a nested package or a version
    variant rather than a package worth a question. `names` is every
    candidate attribute, for spotting version variants."""
    if "." in attr:
        return True
    if PLUMBING.search(attr):
        return True
    if attr.endswith(VARIANT_SUFFIXES):
        return True
    return is_version_variant(attr, names)


def select_pool(candidates, allow, deny, size):
    """Up to `size` candidates: every allowed one present, then the
    highest-ranked by rebuild count that are neither noise nor denied.
    The result is in rank order."""
    names = {c["attr"] for c in candidates}
    ranked = sorted(candidates, key=lambda c: (-c["rebuilds"], c["attr"]))

    # Allowed names get their places first, so a long allow list squeezes
    # the ranked tail rather than overflowing the pool.
    chosen = {c["attr"] for c in ranked if c["attr"] in allow}
    for c in ranked:
        if len(chosen) >= size:
            break
        attr = c["attr"]
        if attr in chosen or attr in deny or is_noise(attr, names):
            continue
        chosen.add(attr)

    return [c for c in ranked if c["attr"] in chosen]


def select_deep(candidates, deny, size, exclude):
    """Up to `size` candidates for the larger tier, leaving out `exclude`
    (the common pool), noise and denied names. Ranked by rebuild count,
    then by how many versions nixpkgs has shipped, which orders the long
    tail that nothing depends on by how long and how actively the package
    has been kept: a browser with 300 versions before a one-off script."""
    names = {c["attr"] for c in candidates}

    def rank(c):
        return (-c["rebuilds"], -(c["versions"] or 0), c["attr"])

    chosen = []
    for c in sorted(candidates, key=rank):
        if len(chosen) >= size:
            break
        attr = c["attr"]
        if attr in exclude or attr in deny or is_noise(attr, names):
            continue
        chosen.append(c)
    return chosen
