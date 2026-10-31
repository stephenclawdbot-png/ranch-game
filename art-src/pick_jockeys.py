"""First pass of the jockey face picks: for each face, the candidate (of the four PixelLab returns)
that keys best (process_jockeys.process): hair key present, a full face, cap and jacket, eyes and
mouth anchors found. Writes art-src/jockey_picks.json; hand overrides go in OVERRIDES below
(after looking at the contact sheet), and the file is what process_jockeys.py reads.

    python3 -I art-src/pick_jockeys.py [id ...]
"""
import importlib.util
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("pj", os.path.join(ROOT, "art-src/process_jockeys.py"))
pj = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pj)

# face id -> chosen stem, by eye where the score's pick looked wrong
OVERRIDES = {"pf-squint": "pf-squint-7589-1", "vm-mutton-chops": "vm-mutton-chops-7593-1"}  # regenerated without the coiled rope


def score(stats, anchors):
    s = 0.0
    s += 3 if 40 <= stats["hair"] <= 1600 else -5
    s += 2 if stats["skin"] >= 700 else -5
    s += 1 if stats["cap"] >= 600 else -3
    s += 1 if stats["body"] >= 1200 else -3
    s += 2 if anchors["eyes"] else 0
    s += 1 if anchors["mouth"] else 0
    return s


def main():
    table = pj.faces_table()
    only = sys.argv[1:]
    out_file = os.path.join(ROOT, "art-src/jockey_picks.json")
    picks = json.load(open(out_file)) if os.path.exists(out_file) else {}
    files = os.listdir(pj.RAW)
    for fid in table:
        if only and fid not in only:
            continue
        cands = sorted(f[:-4] for f in files if re.match(re.escape(fid) + r"-7\d{3}-\d+\.png$", f))
        if not cands:
            print(fid, "NO CANDIDATES")
            continue
        if fid in OVERRIDES:
            picks[fid] = OVERRIDES[fid]
            continue
        best = None
        for c in cands:
            _, anchors, stats = pj.process(c)
            sc = score(stats, anchors)
            if best is None or sc > best[0]:
                best = (sc, c)
        picks[fid] = best[1]
        print(fid, best)
    picks = {k: picks[k] for k in table if k in picks}
    json.dump(picks, open(out_file, "w"), indent=1)


if __name__ == "__main__":
    main()
