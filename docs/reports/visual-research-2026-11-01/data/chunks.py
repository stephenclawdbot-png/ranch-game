import os, gzip, sys, glob
d = sys.argv[1]
files = [f for f in glob.glob(d + "/**/*.js", recursive=True)]
rows = []
for f in files:
    b = open(f, "rb").read()
    rows.append((len(b), len(gzip.compress(b, 9)), os.path.relpath(f, d), b"WebGLRenderer" in b, b"mp4-muxer" in b or b"Muxer" in b))
rows.sort(reverse=True)
tot = sum(r[0] for r in rows); totg = sum(r[1] for r in rows)
print(f"total js {tot//1024} KB raw, {totg//1024} KB gz, {len(rows)} files")
for r in rows[:15]:
    print(f"{r[2]:70s} {r[0]//1024:6d} KB raw {r[1]//1024:5d} KB gz three={r[3]} mux={r[4]}")
