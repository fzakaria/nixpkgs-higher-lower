"""The build graph of nixpkgs, as .drv files, and the rebuild counts read
off it.

A package's rebuild count is how many packages in nixpkgs have its .drv
somewhere in their build closure: change it, and every one of them gets a
new hash and has to be built again.
"""

import re
from concurrent.futures import ThreadPoolExecutor

import numpy

# An input derivation in a .drv's ATerm: `("/nix/store/...drv",["out"])`.
# Only inputDrvs have a quoted .drv path followed by `",[`: inputSrcs are
# bare strings, and quotes inside env values are escaped as \", so neither
# can match.
INPUT_DRV = re.compile(r'\("(/nix/store/[^"\\]+\.drv)",\[')

# How many targets share one pass over the graph. Each pass keeps one
# integer of this many bits per node, so this trades memory for passes:
# 4096 bits is 512 bytes a node, about 250 MB for nixpkgs' half a million
# derivations.
DEFAULT_CHUNK = 4096

# How many universe rows are unpacked into a bit matrix at once while
# counting. 8192 rows of 4096 bits is 32 MB of uint8.
COUNT_ROWS = 8192


def parse_input_drvs(text):
    """The input derivations named in one .drv file's text, in file order."""
    return INPUT_DRV.findall(text)


def read_drv_inputs(path):
    """The input derivations of the .drv at `path` in the local store."""
    with open(path) as f:
        return parse_input_drvs(f.read())


def load_graph(roots, read=read_drv_inputs, threads=1):
    """Walk inputDrvs from `roots`, returning {drv: [input drvs]} for every
    derivation reached. `read` is called once per derivation; a level of
    the walk is read on `threads` threads at once."""
    graph = {}
    frontier = list(dict.fromkeys(roots))
    with ThreadPoolExecutor(max_workers=threads) as pool:
        while frontier:
            # Read this level, then queue whatever it named that is new.
            for path, inputs in zip(frontier, pool.map(read, frontier)):
                graph[path] = inputs

            nxt = {}
            for path in frontier:
                for dep in graph[path]:
                    if dep not in graph:
                        nxt[dep] = None
            frontier = list(nxt)
    return graph


def postorder(graph):
    """Every node of `graph`, each after all of its inputs. Iterative, since
    nixpkgs' bootstrap chain is deeper than Python's recursion limit."""
    order = []
    state = {}
    for root in graph:
        if root in state:
            continue

        # An explicit stack of (node, iterator over its inputs).
        state[root] = 1
        stack = [(root, iter(graph.get(root, ())))]
        while stack:
            node, inputs = stack[-1]
            for dep in inputs:
                if dep not in state:
                    state[dep] = 1
                    stack.append((dep, iter(graph.get(dep, ()))))
                    break
            else:
                stack.pop()
                order.append(node)
    return order


def reverse_closure_counts(graph, universe, targets, chunk=DEFAULT_CHUNK):
    """For each target, how many members of `universe` (not counting the
    target itself) reach it through `graph`. See reverse_closures."""
    counts, _ = reverse_closures(graph, universe, targets, chunk)
    return counts


def reverse_closures(
    graph, universe, targets, chunk=DEFAULT_CHUNK, examples=1, block=COUNT_ROWS
):
    """({target: count}, {target: [first dependents]}).

    The count is how many members of `universe` (not counting the target
    itself) reach the target through `graph`; paths may pass through nodes
    outside the universe. The first dependents are the earliest `examples`
    members, in `universe` order, that do: callers order the universe by
    how well known each member is, and get names people recognise.

    Each node gets one integer used as a bitset over a chunk of targets: a
    node's bits are its own target bit OR its inputs' bits, filled in
    post-order. A universe member's bits are then exactly the targets in its
    closure, the counts are column sums of those rows, and the first
    dependents are the first rows with the column's bit set."""
    order = postorder(graph)
    index = {node: i for i, node in enumerate(order)}
    inputs = [[index[d] for d in graph.get(node, ())] for node in order]
    universe = list(dict.fromkeys(universe))
    members = [index[u] for u in universe]

    counts = {}
    firsts = {}
    targets = list(dict.fromkeys(targets))
    for start in range(0, len(targets), chunk):
        part = targets[start : start + chunk]
        own = [0] * len(order)
        for bit, target in enumerate(part):
            own[index[target]] = 1 << bit

        # Post-order means every input's bits are final before its users'.
        bits = [0] * len(order)
        for i, deps in enumerate(inputs):
            b = own[i]
            for d in deps:
                b |= bits[d]
            bits[i] = b

        # A member is not its own dependent: clear its own bit.
        rows = [bits[m] & ~own[m] for m in members]
        sums, first_rows = column_stats(rows, len(part), examples, block)
        for bit, target in enumerate(part):
            counts[target] = int(sums[bit])
            firsts[target] = [universe[row] for row in first_rows[bit]]
    return counts, firsts


def column_stats(rows, width, examples=1, block=COUNT_ROWS):
    """For bits 0..width-1 of the integers in `rows`: how many rows have
    each bit set, and the indexes of the first `examples` rows that do,
    one list per bit. Rows are unpacked `block` at a time."""
    nbytes = (width + 7) // 8
    sums = numpy.zeros(nbytes * 8, dtype=numpy.int64)
    firsts = [[] for _ in range(width)]
    for start in range(0, len(rows), block):
        part = rows[start : start + block]
        raw = b"".join(r.to_bytes(nbytes, "little") for r in part)
        matrix = numpy.frombuffer(raw, dtype=numpy.uint8).reshape(len(part), nbytes)
        bits = numpy.unpackbits(matrix, axis=1, bitorder="little")
        sums += bits.sum(axis=0, dtype=numpy.int64)

        # Columns still short of examples take this block's first hits.
        hit = bits[:, :width].any(axis=0)
        for column in numpy.flatnonzero(hit):
            wanted = examples - len(firsts[column])
            if wanted <= 0:
                continue
            found = numpy.flatnonzero(bits[:, column])[:wanted]
            firsts[column].extend(start + int(row) for row in found)
    return sums[:width], firsts
