"""Keep only the chosen raws of the anti-repeat batch: each pick's PNG and the job JSON it came
from (with the prompt and seed); other options of the same job and unused jobs are deleted.

    python3 -I art-src/prune_cast_raws.py          # dry run
    python3 -I art-src/prune_cast_raws.py --apply
"""
import importlib.util
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BATCH = {"jockeys": "process_jockeys", "trainers": "process_trainers", "sections": "process_sections", "vignettes": "process_vignettes", "plaques": "process_plaques"}
# style references the generators read
KEEP_ALWAYS = {"plaques": {"style-old-plaque.png"}, "vignettes": {"photo-finish-9803-5.png"}}


def picks(mod):
    spec = importlib.util.spec_from_file_location(mod, os.path.join(ROOT, "art-src", mod + ".py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m.PICKS.values()


def main():
    apply = "--apply" in sys.argv
    gone = 0
    for d, mod in BATCH.items():
        stems = set(picks(mod))
        keep = {s + ".png" for s in stems} | {re.match(r"(.+)-\d+$", s).group(1) + ".json" for s in stems} | KEEP_ALWAYS.get(d, set())
        folder = os.path.join(ROOT, "art-src/raw", d)
        for f in sorted(os.listdir(folder)):
            if f not in keep:
                gone += 1
                if apply:
                    os.remove(os.path.join(folder, f))
        print(d, "keep", len(keep))
    print(("deleted" if apply else "would delete"), gone)


if __name__ == "__main__":
    main()
