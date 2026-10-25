// Download a tiles-pro result: node art-src/fetch-tiles.mjs <tile_id> <out/prefix>
import { get } from "./pixellab.mjs";
import { writeFileSync } from "node:fs";
const [id, prefix] = process.argv.slice(2);
const t = await get(`/tiles-pro/${id}`);
for (const [k, url] of Object.entries(t.storage_urls)) {
  const r = await fetch(url);
  writeFileSync(`${prefix}-${k}.png`, Buffer.from(await r.arrayBuffer()));
}
console.log(Object.keys(t.storage_urls).length, "tiles");
