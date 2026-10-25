// Download every frame of a (review) object: node art-src/fetch-object.mjs <object_id> <out/prefix>
import { get, strip } from "./pixellab.mjs";
import { writeFileSync } from "node:fs";
const [id, prefix] = process.argv.slice(2);
const o = await get(`/objects/${id}`);
const urls = Object.entries(o.storage_urls ?? {}).filter(([, u]) => u);
for (const [k, url] of urls) {
  const r = await fetch(url);
  writeFileSync(`${prefix}-${k.replace("frame_", "")}.png`, Buffer.from(await r.arrayBuffer()));
}
writeFileSync(`${prefix}.json`, JSON.stringify(strip(o), null, 1));
console.log(urls.length, "frames");
