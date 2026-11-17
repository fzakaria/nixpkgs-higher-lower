"""Version counts and first-seen dates from nixpkgs-multiverse.

index/history.json maps attr -> version -> runs of revision offsets into
revisions.json. A run is [first, last], or a list of such pairs when a
version left and came back; a null `last` means still current. See the
multiverse's docs/design.md.

Only the first offset matters here, and the revisions are channel bumps,
not commits: an attribute first seen at offset k was added after revision
k-1 and by revision k. Between 2013-10-31 and 2016-09-24 the index has no
revisions at all, so that window is three years wide, and the game has to
treat a first-seen date as a window rather than a day.
"""


def runs(spans):
    """The [first, last] pairs of one version, flat or nested."""
    if spans and isinstance(spans[0], list):
        return spans
    return [spans]


def version_count(versions):
    """How many distinct versions the attribute ever shipped."""
    return len(versions)


def first_offset(versions):
    """The earliest revision offset any version of the attribute was in."""
    return min(first for spans in versions.values() for first, _ in runs(spans))


def first_seen(versions, dates):
    """The window the attribute was added in: after `after` (None for the
    first revision the index has) and by `by`, as YYYY-MM-DD."""
    k = first_offset(versions)
    return {"after": dates[k - 1] if k > 0 else None, "by": dates[k]}


def stats_for(attr, history, dates):
    """Both multiverse stats for `attr`, or None if the index lacks it."""
    versions = history.get(attr)
    if not versions:
        return None
    return {
        "versions": version_count(versions),
        "firstSeen": first_seen(versions, dates),
    }
