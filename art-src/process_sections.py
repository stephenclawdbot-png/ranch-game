"""Section scenes and wiki figures: chosen PixelLab picks -> served palette PNGs.

    python3 -I art-src/process_sections.py

Each pick is a 688x288 golden-hour scene (art-src/gen-sections.mjs). Kept at native size (the
page kit shows it at 1x/2x/3x with nearest filtering), stored as an exact palette PNG when the
picture has at most 256 colours, otherwise quantised to 256 without dithering.
Output: apps/web/public/art/scenes/<id>.png
"""
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "art-src/raw/sections")
OUT = os.path.join(ROOT, "apps/web/public/art/scenes")

PICKS = {
    "club-lawn": "club-lawn-9501-0",
    "winners-enclosure": "winners-enclosure-9511-0",
    "weighing-room": "weighing-room-9521-0",
    "stud-dawn": "stud-dawn-9531-0",
    "hall-of-fame": "hall-of-fame-9541-0",
    "press-room": "press-room-9651-0",
    "form-rail": "form-rail-9661-0",
    "foaling-barn": "foaling-barn-9571-0",
    "estate-office": "estate-office-9681-0",
    "retirement-meadow": "retirement-meadow-9591-0",
    "club-library": "club-library-9711-0",
    "yard-works": "yard-works-9621-0",
    "vet-room": "vet-room-9631-0",
    "grooming-aisle": "grooming-aisle-9641-0",
    "farrier-forge": "farrier-forge-9651-0",
    "stud-book": "stud-book-9661-0",
    "starting-stalls": "starting-stalls-9671-0",
    "pedigree-wall": "pedigree-wall-9671-0",
    # graphics round 2 (art-src/gen-scenes2.mjs); the Quick races gallops is now gallops-downs (no motor car)
    "story-road": "story-road-9401-0",
    "chapter-club": "chapter-club-9411-0",
    "chapter-county": "chapter-county-9421-0",
    "chapter-national": "chapter-national-9431-0",
    "chapter-classics": "chapter-classics-9441-0",
    "owners-office": "owners-office-9451-0",
    "club-entrance": "club-entrance-9461-0",
    "prize-giving": "prize-giving-9471-0",
    "sponsor-marquee": "sponsor-marquee-9481-0",
    "grooming-bay": "grooming-bay-9491-0",
    "trainer-gallops": "trainer-gallops-9501-0",
    "trophy-shelf": "trophy-shelf-9511-0",
    "logbook-desk": "logbook-desk-9521-0",
    "stable-arch": "stable-arch-9531-0",
    "registration-desk": "registration-desk-9541-0",
    "owners-bar": "owners-bar-9551-0",
    "gallops-downs": "gallops-downs-9561-0",
    "wiki-estate-gate": "wiki-estate-gate-9571-0",
    "wiki-led-out": "wiki-led-out-9581-0",
    "wiki-final-bend": "wiki-final-bend-9591-0",
    "wiki-mare-foal": "wiki-mare-foal-9601-0",
    "wiki-old-champion": "wiki-old-champion-9611-0",
    "wiki-auction-rostrum": "wiki-auction-rostrum-9621-0",
    "wiki-trophy-cabinet": "wiki-trophy-cabinet-9631-0",
    "wiki-estate-map": "wiki-estate-map-9641-0",
    "wiki-stable-row": "wiki-stable-row-9651-0",
    "wiki-turnstiles": "wiki-turnstiles-9661-0",
    "wiki-pavilion": "wiki-pavilion-9671-0",
    "wiki-sales-paddock": "wiki-sales-paddock-9681-0",
    "wiki-first-horse": "wiki-first-horse-9691-0",
    "wiki-declarations": "wiki-declarations-9701-0",
    "wiki-box-rest": "wiki-box-rest-9711-0",
    "wiki-meeting-day": "wiki-meeting-day-9721-0",
    "wiki-final-furlong": "wiki-final-furlong-9731-0",
    "wiki-time-trial": "wiki-time-trial-9741-0",
    "wiki-builders-plans": "wiki-builders-plans-9751-0",
    "wiki-dictionary": "wiki-dictionary-9761-0",
    "wiki-stallion-yard": "wiki-stallion-yard-9771-0",
    "wiki-league-board": "wiki-league-board-9781-0",
    "wiki-yearlings": "wiki-yearlings-9791-0",
    "wiki-old-friends": "wiki-old-friends-9801-0",
    "wiki-bloodlines": "wiki-bloodlines-9811-0",
    "wiki-handshake": "wiki-handshake-9821-0",
    "wiki-silver-polish": "wiki-silver-polish-9831-0",
    "saturday-eve": "saturday-eve-9571-0",
    "wiki-exercise-ring": "wiki-exercise-ring-9811-0",
}


def main():
    os.makedirs(OUT, exist_ok=True)
    only = sys.argv[1:]
    for sid, stem in PICKS.items():
        if only and sid not in only:
            continue
        im = Image.open(os.path.join(RAW, stem + ".png")).convert("RGB")
        colours = im.getcolors(1 << 16)
        n = len(colours) if colours else 1 << 16
        q = im.quantize(colors=min(n, 256), method=Image.Quantize.MEDIANCUT if n > 256 else Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
        out = os.path.join(OUT, sid + ".png")
        q.save(out, optimize=True)
        print(sid, stem, im.size, "colours", n, os.path.getsize(out) // 1024, "KB")


if __name__ == "__main__":
    main()
