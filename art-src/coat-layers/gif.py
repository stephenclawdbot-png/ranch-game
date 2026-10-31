"""Animated GIFs (2x, nearest) from the frames anim.ts wrote: python3 -I gif.py <outDir> [fps]"""
import glob
import os
import sys
from collections import defaultdict

from PIL import Image

out = sys.argv[1]
fps = int(sys.argv[2]) if len(sys.argv) > 2 else 10
groups = defaultdict(list)
for f in sorted(glob.glob(os.path.join(out, "frames", "*.png"))):
    groups[os.path.basename(f).rsplit("-", 1)[0]].append(f)
for tag, files in groups.items():
    frames = [Image.open(f).convert("RGB") for f in files]
    frames = [fr.resize((fr.width * 2, fr.height * 2), Image.NEAREST) for fr in frames]
    frames[0].save(os.path.join(out, tag + ".gif"), save_all=True, append_images=frames[1:], duration=int(1000 / fps), loop=0)
    print(tag, len(frames))
