# Tests for tools/rhl/drvgraph.py: reading inputDrvs out of ATerm .drv
# text, walking the graph from a set of roots, and counting, for each
# target, how many packages have it somewhere in their build closure.
# Every test builds its graph in memory, so none of them touch the store.

import unittest

from tools.rhl import drvgraph


def drv(name):
    """A store path for a made-up derivation called `name`."""
    return f"/nix/store/{'a' * 32}-{name}.drv"


# A .drv as Nix writes it, trimmed: two outputs, two input derivations
# (one with two outputs requested), one input source, and an env whose
# values contain quotes, brackets and the text of a .drv path, none of
# which may be mistaken for an input.
SAMPLE = (
    'Derive([("dev","/nix/store/bbbb-hello-2.12.2-dev","",""),'
    '("out","/nix/store/cccc-hello-2.12.2","","")],'
    f'[("{drv("bash-5.3")}",["out"]),("{drv("gcc-wrapper-15")}",["lib","out"])],'
    '["/nix/store/dddd-default-builder.sh"],'
    '"x86_64-linux","/nix/store/eeee-bash/bin/bash",["-e","builder.sh"],'
    '[("name","hello"),("trap","(\\"' + drv("not-an-input") + '\\",[\\"out\\"])"),'
    '("weird","],[")])'
)


class ParseInputDrvsTest(unittest.TestCase):
    """parse_input_drvs returns exactly the input derivations of a .drv."""

    def test_sample(self):
        # Both inputs come back, in file order, and nothing from env does.
        self.assertEqual(
            drvgraph.parse_input_drvs(SAMPLE),
            [drv("bash-5.3"), drv("gcc-wrapper-15")],
        )

    def test_no_inputs(self):
        # A fixed-output fetch with no input derivations has an empty list.
        text = 'Derive([("out","/nix/store/ffff-src","sha256","00")],[],[],"builtin","builtin:fetchurl",[],[])'
        self.assertEqual(drvgraph.parse_input_drvs(text), [])


class LoadGraphTest(unittest.TestCase):
    """load_graph follows inputDrvs from the roots and reads each .drv once."""

    def test_walks_transitively_and_reads_once(self):
        # a -> b -> d and a -> c -> d: d is shared and must be read once.
        edges = {
            drv("a"): [drv("b"), drv("c")],
            drv("b"): [drv("d")],
            drv("c"): [drv("d")],
            drv("d"): [],
        }
        reads = []

        def read(path):
            reads.append(path)
            return edges[path]

        graph = drvgraph.load_graph([drv("a")], read)
        self.assertEqual(graph, edges)
        self.assertEqual(sorted(reads), sorted(edges))


class ReverseClosureCountsTest(unittest.TestCase):
    """reverse_closure_counts counts the universe members that depend on
    each target, directly or through drvs outside the universe."""

    # The graph, dependencies pointing down:
    #
    #   app1   app2   app3      (the universe, plus lib1 and lib2)
    #     \     |      |
    #      lib1 |     wrapper   (wrapper is not in the universe)
    #        \  |      |
    #         lib2 ----+
    #           |
    #          libc             (not in the universe, but a target)
    GRAPH = {
        "app1": ["lib1"],
        "app2": ["lib2"],
        "app3": ["wrapper"],
        "wrapper": ["lib2"],
        "lib1": ["lib2"],
        "lib2": ["libc"],
        "libc": [],
    }
    UNIVERSE = ["app1", "app2", "app3", "lib1", "lib2"]

    def test_counts(self):
        # libc: all five universe members reach it. lib2: everyone but
        # itself. lib1: only app1. app3: nothing depends on it.
        counts = drvgraph.reverse_closure_counts(
            self.GRAPH, self.UNIVERSE, ["libc", "lib2", "lib1", "app3"]
        )
        self.assertEqual(counts, {"libc": 5, "lib2": 4, "lib1": 1, "app3": 0})

    def test_chunking_does_not_change_the_answer(self):
        # Targets are processed a chunk of bits at a time; a chunk of one
        # and a chunk of three must agree with the single-chunk answer.
        targets = ["libc", "lib2", "lib1", "app3", "app1"]
        whole = drvgraph.reverse_closure_counts(self.GRAPH, self.UNIVERSE, targets)
        for chunk in (1, 3):
            self.assertEqual(
                drvgraph.reverse_closure_counts(self.GRAPH, self.UNIVERSE, targets, chunk=chunk),
                whole,
            )

    def test_first_dependents_follow_universe_order(self):
        # reverse_closures also names, per target, the first `examples`
        # universe members (in the order given) that depend on it, never
        # the target itself, and an empty list when nothing does. With
        # app3 listed first it leads libc's and lib2's examples; lib1's
        # only dependent is app1. Chunks of three must not change them.
        order = ["app3", "lib2", "app1", "app2", "lib1"]
        counts, examples = drvgraph.reverse_closures(
            self.GRAPH, order, ["libc", "lib2", "lib1", "app3"], chunk=3, examples=2
        )
        self.assertEqual(counts, {"libc": 5, "lib2": 4, "lib1": 1, "app3": 0})
        self.assertEqual(
            examples,
            {
                "libc": ["app3", "lib2"],
                "lib2": ["app3", "app1"],
                "lib1": ["app1"],
                "app3": [],
            },
        )

    def test_examples_span_count_blocks(self):
        # Rows are counted a block at a time; a target whose dependents
        # sit in different blocks still gets them in universe order.
        graph = {f"n{i}": ["lib"] for i in range(10)}
        graph["lib"] = []
        order = [f"n{i}" for i in range(10)]
        _, examples = drvgraph.reverse_closures(graph, order, ["lib"], examples=4, block=3)
        self.assertEqual(examples, {"lib": ["n0", "n1", "n2", "n3"]})

    def test_deep_chain_has_no_recursion_limit(self):
        # A 50,000-long chain: the topological walk must be iterative.
        n = 50_000
        graph = {f"n{i}": [f"n{i + 1}"] for i in range(n)}
        graph[f"n{n}"] = []
        universe = [f"n{i}" for i in range(0, n + 1, 1000)]
        counts = drvgraph.reverse_closure_counts(graph, universe, [f"n{n}"])
        self.assertEqual(counts, {f"n{n}": len(universe) - 1})


if __name__ == "__main__":
    unittest.main()
