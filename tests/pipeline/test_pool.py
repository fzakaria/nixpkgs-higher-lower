# Tests for tools/rhl/pool.py: naming each derivation once when several
# attributes alias it, telling recognisable packages from plumbing, and
# choosing the pool from the ranked candidates plus the hand-kept lists.
# Inputs are small literal tables.

import unittest

from tools.rhl import pool


class CanonicalAttrsTest(unittest.TestCase):
    """canonical_attrs picks one attribute name per derivation."""

    def test_shortest_name_wins_then_alphabetical(self):
        # python3, python313 and python313Full are one derivation; python3
        # is the name people type. zz and aa tie on length and fall back to
        # alphabetical order so the choice never depends on input order.
        entries = [
            {"attr": "python313Full", "drvPath": "py"},
            {"attr": "python313", "drvPath": "py"},
            {"attr": "python3", "drvPath": "py"},
            {"attr": "zz", "drvPath": "tie"},
            {"attr": "aa", "drvPath": "tie"},
        ]
        self.assertEqual(pool.canonical_attrs(entries), {"py": "python3", "tie": "aa"})

    def test_nested_attributes_never_name_a_derivation(self):
        # python3Packages.foo and foo being one drv: the top-level name
        # wins even though it is longer than nothing.
        entries = [
            {"attr": "python3Packages.httpie", "drvPath": "h"},
            {"attr": "httpie", "drvPath": "h"},
            {"attr": "haskellPackages.only", "drvPath": "o"},
        ]
        self.assertEqual(pool.canonical_attrs(entries), {"h": "httpie"})

    def test_preferred_then_pname_then_lowercase(self):
        # jdk is shorter, but openjdk is the pname. superTuxKart and
        # supertuxkart tie on length and the lowercase spelling, which is
        # also the pname, wins. jre is shorter than both, but a preferred
        # name (an allow-list entry) beats every other rule.
        entries = [
            {"attr": "jdk", "drvPath": "j", "pname": "openjdk"},
            {"attr": "openjdk", "drvPath": "j", "pname": "openjdk"},
            {"attr": "superTuxKart", "drvPath": "s", "pname": "supertuxkart"},
            {"attr": "supertuxkart", "drvPath": "s", "pname": "supertuxkart"},
            {"attr": "jre", "drvPath": "r", "pname": "openjdk"},
            {"attr": "openjdk-runtime", "drvPath": "r", "pname": "openjdk"},
            {"attr": "camelCase", "drvPath": "c", "pname": None},
            {"attr": "lowercase", "drvPath": "c", "pname": None},
        ]
        self.assertEqual(
            pool.canonical_attrs(entries, prefer={"openjdk-runtime"}),
            {"j": "openjdk", "s": "supertuxkart", "r": "openjdk-runtime", "c": "lowercase"},
        )


class NoiseTest(unittest.TestCase):
    """is_noise flags build plumbing, splits and variants by name."""

    def test_plumbing(self):
        for attr in [
            "gcc-unwrapped",
            "stdenv",
            "stdenvNoCC",
            "autoreconfHook",
            "update-autotools-gnu-config-scripts-hook",
            "bootstrap-tools",
            "systemdMinimal",
            "systemdLibs",
            "python3Minimal",
            "zeroad-data",
            "firefox-bin",
            "ffmpeg-headless",
            "ffmpeg_8-headless",
            "harfbuzzFull",
            "valgrind-light",
            "nodejs-slim",
            "openblasCompat",
            "python3Packages.requests",
        ]:
            with self.subTest(attr=attr):
                self.assertTrue(pool.is_noise(attr, names=set()))

    def test_packages_people_know(self):
        for attr in ["hello", "zstd", "bzip2", "x264", "gtk3", "python3", "qt6", "_7zz"]:
            with self.subTest(attr=attr):
                self.assertFalse(pool.is_noise(attr, names=set()))

    def test_version_variants_of_a_present_package(self):
        # A version-suffixed attribute is a variant only when a shorter
        # spelling of the same package is also a candidate.
        names = {"nodejs", "nodejs_22", "python3", "python314", "gcc", "gcc14", "lua5"}
        self.assertTrue(pool.is_noise("nodejs_22", names))
        self.assertTrue(pool.is_noise("python314", names))
        self.assertTrue(pool.is_noise("gcc14", names))
        self.assertTrue(pool.is_noise("lua5_4", names | {"lua5_4"}))
        self.assertTrue(pool.is_noise("tcl-9_0", names | {"tcl"}))
        self.assertFalse(pool.is_noise("python3", names))
        self.assertFalse(pool.is_noise("ruby_3_4", names))


class SelectPoolTest(unittest.TestCase):
    """select_pool ranks by rebuild count and applies the allow/deny lists."""

    CANDIDATES = [
        {"attr": "glibc", "rebuilds": 900},
        {"attr": "gcc-unwrapped", "rebuilds": 950},
        {"attr": "zlib", "rebuilds": 800},
        {"attr": "expand-response-params", "rebuilds": 700},
        {"attr": "openssl", "rebuilds": 500},
        {"attr": "curl", "rebuilds": 400},
        {"attr": "firefox", "rebuilds": 2},
        {"attr": "systemdMinimal", "rebuilds": 300},
    ]

    def attrs(self, **kw):
        return [p["attr"] for p in pool.select_pool(self.CANDIDATES, **kw)]

    def test_ranked_and_filtered(self):
        # Noise and denied names drop out; the rest come in rank order
        # until the pool is full.
        self.assertEqual(
            self.attrs(allow=set(), deny={"expand-response-params"}, size=3),
            ["glibc", "zlib", "openssl"],
        )

    def test_allow_list_always_gets_in(self):
        # firefox ranks last and systemdMinimal is noise, but both are
        # allowed, so they take places ahead of the ranked tail.
        self.assertEqual(
            self.attrs(allow={"firefox", "systemdMinimal"}, deny=set(), size=4),
            ["glibc", "zlib", "systemdMinimal", "firefox"],
        )

    def test_allowed_name_missing_from_nixpkgs_is_ignored(self):
        self.assertEqual(
            self.attrs(allow={"not-a-package"}, deny=set(), size=2),
            ["glibc", "zlib"],
        )


class SelectDeepTest(unittest.TestCase):
    """select_deep fills the larger tier: the packages not already in the
    common pool, ranked by rebuild count and then, for the long tail with
    equal counts, by how many versions nixpkgs has shipped."""

    CANDIDATES = [
        {"attr": "glibc", "rebuilds": 900, "versions": 20},
        {"attr": "libfoo", "rebuilds": 50, "versions": 3},
        {"attr": "gcc-unwrapped", "rebuilds": 950, "versions": 30},
        {"attr": "obscure", "rebuilds": 0, "versions": 2},
        {"attr": "busy-app", "rebuilds": 0, "versions": 90},
        {"attr": "gone-from-index", "rebuilds": 0, "versions": None},
        {"attr": "denied", "rebuilds": 70, "versions": 9},
    ]

    def test_ranked_after_the_common_pool(self):
        chosen = pool.select_deep(self.CANDIDATES, deny={"denied"}, size=4, exclude={"glibc"})
        self.assertEqual(
            [c["attr"] for c in chosen],
            ["libfoo", "busy-app", "obscure", "gone-from-index"],
        )
        self.assertEqual(
            [c["attr"] for c in pool.select_deep(self.CANDIDATES, set(), 2, {"glibc"})],
            ["denied", "libfoo"],
        )


class ReadListTest(unittest.TestCase):
    """read_list reads one name per line, in file order, ignoring comments
    and blanks."""

    def test_comments(self):
        text = "# header\nfirefox  # the browser\n\n  vim\n"
        self.assertEqual(pool.read_list(text), ["firefox", "vim"])


class InterleaveSectionsTest(unittest.TestCase):
    """interleave_sections reads an allow list's sections, each started by
    a comment line, and takes one name from each section in turn, so the
    first few names cover several kinds of package."""

    def test_round_robin(self):
        text = (
            "# header\n#\n# more header\n"
            "# browsers\nfirefox\nchromium\nlibrewolf\n"
            "# editors\nemacs\nvim\n"
            "# games\nsuperTux\n"
        )
        self.assertEqual(
            pool.interleave_sections(text),
            ["firefox", "emacs", "superTux", "chromium", "vim", "librewolf"],
        )


if __name__ == "__main__":
    unittest.main()
