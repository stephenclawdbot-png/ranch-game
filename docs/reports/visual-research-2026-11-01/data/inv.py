import os, sys, collections, struct
root = sys.argv[1]
by = collections.defaultdict(lambda: [0, 0, collections.Counter()])
big = []
for dp, dn, fn in os.walk(root):
    for f in fn:
        p = os.path.join(dp, f); rel = os.path.relpath(p, root)
        top = "/".join(rel.split("/")[:2]) if rel.startswith("art/") else rel.split("/")[0]
        s = os.path.getsize(p); by[top][0] += 1; by[top][1] += s; by[top][2][f.rsplit(".", 1)[-1]] += 1
        if f.endswith(".png"):
            with open(p, "rb") as fh: h = fh.read(24)
            w, hh = struct.unpack(">II", h[16:24]); big.append((w * hh * 4, rel, w, hh, s))
for k, (n, s, c) in sorted(by.items(), key=lambda x: -x[1][1]):
    print(f"{k:28s} {n:5d} files {s/1e6:7.2f} MB  {dict(c)}")
big.sort(reverse=True)
print("\nlargest decoded PNGs (RGBA bytes):")
for b in big[:12]: print(f"  {b[1]:60s} {b[2]}x{b[3]}  decoded {b[0]/1e6:.1f} MB  file {b[4]/1e3:.0f} KB")
print("total decoded RGBA of all PNGs: %.0f MB" % (sum(b[0] for b in big) / 1e6))
race = [b for b in big if b[1].startswith("art/race/")]
print("race/ decoded RGBA: %.1f MB in %d PNGs" % (sum(b[0] for b in race) / 1e6, len(race)))
