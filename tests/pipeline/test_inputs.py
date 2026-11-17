# Tests for the pipeline's two readers of outside data: nix-eval-jobs'
# JSON lines (tools/rhl/evaljobs.py) and cache.nixos.org's narinfos
# (tools/rhl/closure.py). The narinfo tests serve a made-up cache from a
# dict, so they need no network.

import json
import unittest

from tools.rhl import closure, evaljobs


def line(**fields):
    return json.dumps(fields)


class ReadEvalTest(unittest.TestCase):
    """read_eval keeps attributes that evaluated and counts the rest."""

    def test_records_and_errors(self):
        lines = [
            line(
                attr="hello",
                drvPath="/nix/store/h.drv",
                name="hello-2.12.2",
                outputs={"out": "/nix/store/h-out", "man": "/nix/store/h-man"},
                extraValue={
                    "pname": "hello",
                    "version": "2.12.2",
                    "description": "Says hello",
                    "homepage": "https://www.gnu.org/software/hello/",
                    "outputName": "out",
                },
            ),
            line(attr="gone", error="error: 'gone' has been removed"),
            # ffmpeg's default output is bin, and its out is a near-empty
            # directory. nix-eval-jobs prints outputs sorted by name, so the
            # default has to come from the derivation's outputName.
            line(
                attr="ffmpeg",
                drvPath="/nix/store/f.drv",
                name="ffmpeg-8.0",
                outputs={
                    "bin": "/nix/store/f-bin",
                    "lib": "/nix/store/f-lib",
                    "out": "/nix/store/f-out",
                },
                extraValue={
                    "pname": None,
                    "version": None,
                    "description": None,
                    "homepage": None,
                    "outputName": "bin",
                },
            ),
            "",
        ]
        records, errors = evaljobs.read_eval(lines)
        self.assertEqual(errors, 1)
        self.assertEqual(
            records,
            [
                {
                    "attr": "hello",
                    "drvPath": "/nix/store/h.drv",
                    "name": "hello-2.12.2",
                    "out": "/nix/store/h-out",
                    "pname": "hello",
                    "version": "2.12.2",
                    "description": "Says hello",
                    "homepage": "https://www.gnu.org/software/hello/",
                },
                {
                    "attr": "ffmpeg",
                    "drvPath": "/nix/store/f.drv",
                    "name": "ffmpeg-8.0",
                    "out": "/nix/store/f-bin",
                    "pname": None,
                    "version": None,
                    "description": None,
                    "homepage": None,
                },
            ],
        )


NARINFO = """StorePath: /nix/store/{name}
URL: nar/x.nar.zst
Compression: zstd
NarHash: sha256-AAAA
NarSize: {size}
References: {refs}
Sig: cache.nixos.org-1:sig
"""


def narinfo(name, size, refs):
    return NARINFO.format(name=name, size=size, refs=" ".join(refs))


class ParseNarinfoTest(unittest.TestCase):
    """parse_narinfo reads the size and the references as store paths."""

    def test_parse(self):
        text = narinfo("aaaa-app", 100, ["aaaa-app", "bbbb-libc"])
        self.assertEqual(
            closure.parse_narinfo(text),
            (100, ["/nix/store/aaaa-app", "/nix/store/bbbb-libc"]),
        )

    def test_no_references(self):
        self.assertEqual(closure.parse_narinfo(narinfo("cccc-src", 7, [])), (7, []))


class ClosureSizesTest(unittest.TestCase):
    """closure_sizes sums NarSize over each root's runtime closure, counts a
    shared path once, and gives None for a root the cache lacks."""

    CACHE = {
        "aaaa-app": narinfo("aaaa-app", 100, ["aaaa-app", "bbbb-lib", "cccc-libc"]),
        "bbbb-lib": narinfo("bbbb-lib", 20, ["cccc-libc"]),
        "cccc-libc": narinfo("cccc-libc", 3, ["cccc-libc"]),
        "dddd-tool": narinfo("dddd-tool", 1000, ["cccc-libc"]),
    }

    def fetch(self, path):
        self.fetched.append(path)
        return self.CACHE.get(path.removeprefix("/nix/store/"))

    def setUp(self):
        self.fetched = []

    def test_sizes(self):
        roots = ["/nix/store/aaaa-app", "/nix/store/dddd-tool", "/nix/store/eeee-unfree"]
        sizes = closure.closure_sizes(roots, self.fetch, threads=2)
        self.assertEqual(
            sizes,
            {
                "/nix/store/aaaa-app": 123,
                "/nix/store/dddd-tool": 1003,
                "/nix/store/eeee-unfree": None,
            },
        )
        # Each narinfo is fetched once, however many closures share it.
        self.assertEqual(len(self.fetched), len(set(self.fetched)))

    def test_known_narinfos_are_not_fetched_again(self):
        # A second walk handed the first walk's narinfos fetches only what
        # is new: here dddd-tool, since the libc it needs is known.
        info = {}
        closure.closure_sizes(["/nix/store/aaaa-app"], self.fetch, threads=2, info=info)
        self.fetched = []
        sizes = closure.closure_sizes(["/nix/store/dddd-tool"], self.fetch, threads=2, info=info)
        self.assertEqual(sizes, {"/nix/store/dddd-tool": 1003})
        self.assertEqual(self.fetched, ["/nix/store/dddd-tool"])


if __name__ == "__main__":
    unittest.main()
