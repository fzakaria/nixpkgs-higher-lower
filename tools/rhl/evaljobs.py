"""Reading nix-eval-jobs' output, as tools/eval-drvs.sh writes it."""

import json

# The fields tools/eval-drvs.sh asks for with --apply.
EXTRA_FIELDS = ("pname", "version", "description", "homepage")

# A derivation's default output when it does not say.
DEFAULT_OUTPUT = "out"


def read_eval(lines):
    """(records, errors): one record per attribute that evaluated, and how
    many did not (removed aliases, broken or unsupported packages)."""
    records = []
    errors = 0
    for raw in lines:
        if not raw.strip():
            continue

        job = json.loads(raw)
        if "error" in job or "drvPath" not in job:
            errors += 1
            continue

        # The default output: drv.outputName, the first entry of the
        # derivation's outputs list. nix-eval-jobs prints outputs sorted by
        # name, so their order says nothing, and guessing `out` is wrong for
        # ffmpeg, whose out is a 96-byte NAR and whose programs are in bin.
        extra = job.get("extraValue") or {}
        outputs = job["outputs"]
        out = outputs[extra.get("outputName") or DEFAULT_OUTPUT]

        record = {
            "attr": job["attr"],
            "drvPath": job["drvPath"],
            "name": job["name"],
            "out": out,
        }
        for field in EXTRA_FIELDS:
            record[field] = extra.get(field)
        records.append(record)
    return records, errors
