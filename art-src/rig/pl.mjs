#!/usr/bin/env node
// PixelLab helper for the pixel-rig source material. Reuses the shared client in
// art-src/pixellab.mjs (key read at runtime from ~/.config/pixellab/key) but logs to
// art-src/rig/generation-log.jsonl.
//   node art-src/rig/pl.mjs <endpoint> <request.json> <out/prefix>
//   node art-src/rig/pl.mjs balance
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { post, pollJob, balance, collectImages, saveBase64Png, strip, b64img } from "../pixellab.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOG = join(HERE, "generation-log.jsonl");

/** Replace {"$file": "path"} entries with base64 image objects. */
function inflate(v) {
  if (Array.isArray(v)) return v.map(inflate);
  if (v && typeof v === "object") {
    if (typeof v.$file === "string") return b64img(v.$file);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, inflate(x)]));
  }
  return v;
}

const [cmd, reqFile, prefix] = process.argv.slice(2);
if (cmd === "balance") {
  console.log(JSON.stringify(await balance()));
} else if (cmd && reqFile && prefix) {
  const t0 = Date.now();
  const request = inflate(JSON.parse(readFileSync(reqFile, "utf8")));
  const response = await post(cmd, request);
  const jobId = response.background_job_id ?? response.job_id ?? null;
  const job = jobId ? await pollJob(jobId) : null;
  const imgs = collectImages(job ?? response);
  const files = imgs.map((b, i) => saveBase64Png(b, `${prefix}-${i}.png`));
  writeFileSync(`${prefix}.json`, JSON.stringify({ endpoint: cmd, request: strip(request), response: strip(response), job: job && strip(job), files }, null, 1));
  const usage = job?.usage ?? response.usage ?? null;
  appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), endpoint: cmd, prefix, secs: Math.round((Date.now() - t0) / 1000), usage, images: files.length }) + "\n");
  console.log(JSON.stringify({ files, usage }));
} else {
  console.error("usage: pl.mjs balance | <endpoint> <request.json> <out/prefix>");
  process.exit(2);
}
