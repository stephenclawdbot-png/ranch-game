// Write art-src/meta/prompts.json: job name -> {endpoint, description} for every scripted job
// (raw job logs written before 2026-10-25 17:30 truncated long prompts).
import { writeFileSync } from "node:fs";
process.argv.length = 2; // import the job tables without running any job
const { JOBS } = await import("./gen-scene.mjs");
const out = {};
for (const [k, j] of Object.entries(JOBS)) out[`scene/${k}`] = { endpoint: j.ep, description: j.body.description ?? j.body.action ?? null };
writeFileSync(new URL("./meta/prompts.json", import.meta.url), JSON.stringify(out, null, 1));
console.log(Object.keys(out).length, "prompts");
