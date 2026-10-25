// Normal map for a strip wider than 512 px: split into frames, /normal-map each, re-join.
//   node art-src/normals-strip.mjs <strip.png> <frameCount> <out.png> [kind] [mode]
import { run, b64img } from "./pixellab.mjs";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
const [inp, n, out, kind = "character", mode = "pro"] = process.argv.slice(2);
const dir = `art-src/raw/normals/${out.split("/").pop().replace(/\.png$/, "")}`;
mkdirSync(dir, { recursive: true });
execFileSync("python3", ["-I", "-c", `
from PIL import Image
im=Image.open("${inp}"); n=${n}; w=im.width//n
for i in range(n): im.crop((i*w,0,(i+1)*w,im.height)).save(f"${dir}/f{i}.png")`]);
const files = [];
for (let i = 0; i < Number(n); i++) {
  const r = await run("/normal-map", { image: b64img(`${dir}/f${i}.png`), mode, kind }, `${dir}/n${i}`);
  files.push(r.files[0]);
}
execFileSync("python3", ["-I", "-c", `
from PIL import Image
fs=${JSON.stringify(files)}
ims=[Image.open(f).convert("RGBA") for f in fs]
out=Image.new("RGBA",(sum(i.width for i in ims),ims[0].height))
x=0
for i in ims: out.paste(i,(x,0)); x+=i.width
out.save("${out}", optimize=True)`]);
console.log(out, files.length, "frames");
