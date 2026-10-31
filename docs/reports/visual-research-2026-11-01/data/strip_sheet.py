"""Contact sheet of an animation strip: frames laid out in a grid, 2x nearest, with frame numbers."""
import sys
from PIL import Image, ImageDraw
src, n, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 4
im = Image.open(src).convert("RGBA")
fw, fh = im.width // n, im.height
rows = (n + cols - 1) // cols
S = 2
sheet = Image.new("RGBA", (cols * fw * S, rows * (fh * S + 16)), (235, 230, 215, 255))
d = ImageDraw.Draw(sheet)
for i in range(n):
    f = im.crop((i * fw, 0, (i + 1) * fw, fh)).resize((fw * S, fh * S), Image.NEAREST)
    x, y = (i % cols) * fw * S, (i // cols) * (fh * S + 16)
    sheet.alpha_composite(f, (x, y + 16))
    d.text((x + 4, y + 2), f"frame {i}", fill=(0, 0, 0, 255))
    d.line((x, y + 16 + fh * S - 2, x + fw * S, y + 16 + fh * S - 2), fill=(120, 90, 60, 255))
sheet.convert("RGB").save(out)
print(out, sheet.size)
