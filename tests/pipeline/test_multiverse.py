# Tests for tools/rhl/multiverse.py: reading version counts and first-seen
# dates out of nixpkgs-multiverse's index/history.json, whose runs are
# either [first, last] or a list of such pairs, with null for "still
# current". The revision dates below copy the shape of revisions.json,
# including its real 2013-10 to 2016-09 gap.

import unittest

from tools.rhl import multiverse

DATES = ["2012-07-05", "2012-08-01", "2013-10-31", "2016-09-24", "2016-10-13"]

HELLO = {
    "2.10": [[3, 3], [4, None]],
    "2.7": [0, 0],
    "2.8": [1, 2],
}


class VersionCountTest(unittest.TestCase):
    """version_count is the number of distinct versions, however split."""

    def test_count(self):
        self.assertEqual(multiverse.version_count(HELLO), 3)


class FirstOffsetTest(unittest.TestCase):
    """first_offset is the earliest revision offset across every run."""

    def test_nested_and_flat_runs(self):
        self.assertEqual(multiverse.first_offset(HELLO), 0)
        self.assertEqual(multiverse.first_offset({"1": [[4, None]], "2": [3, 3]}), 3)


class FirstSeenTest(unittest.TestCase):
    """first_seen turns an offset into the window it was added in."""

    def test_window_between_two_revisions(self):
        # Seen first at offset 3: added after the 2013-10-31 revision and
        # by the 2016-09-24 one, a three-year window the game must respect.
        self.assertEqual(
            multiverse.first_seen({"1": [3, 4]}, DATES),
            {"after": "2013-10-31", "by": "2016-09-24"},
        )

    def test_first_revision_has_no_lower_bound(self):
        self.assertEqual(multiverse.first_seen(HELLO, DATES), {"after": None, "by": "2012-07-05"})


class JoinTest(unittest.TestCase):
    """stats_for returns both stats, or None for an attribute the index lacks."""

    def test_join(self):
        history = {"hello": HELLO}
        self.assertEqual(
            multiverse.stats_for("hello", history, DATES),
            {"versions": 3, "firstSeen": {"after": None, "by": "2012-07-05"}},
        )
        self.assertIsNone(multiverse.stats_for("absent", history, DATES))


if __name__ == "__main__":
    unittest.main()
